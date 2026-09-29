/** Per-Profile completion state for the launcher-owned Desktop Setup Wizard. */

import { createHash } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  unlinkSync,
} from 'node:fs'
import type { Stats } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { parseSemVer } from './update-checker.ts'

const BIN_NAME = 'dsh-plugin-desktop'
const LEGACY_STATE_VERSION = 1
const STATE_VERSION = 2
const SETUP_REVISION = 1
const STATE_ROOT_DIRECTORY = 'profile-setup'
const STATE_FILENAME = 'state.json'
const MAX_STATE_BYTES = 4 * 1024
const HASH_PATTERN = /^[0-9a-f]{64}$/u

/** Durable outcome that suppresses the Wizard for one Profile. */
export type DesktopSetupWizardOutcome = 'completed' | 'skipped'

/** Strict marker stored beneath the Electron user-data directory. */
export interface DesktopSetupWizardStateV1 {
  readonly version: 1
  readonly profileHash: string
  readonly outcome: DesktopSetupWizardOutcome
}

/** Installed product versions evaluated by the current Setup flow. */
export interface DesktopSetupWizardVersions {
  readonly desktopVersion: string
  readonly dshVersion: string
  readonly setupRevision: number
}

/** Current strict marker written after Setup is completed or explicitly skipped. */
export interface DesktopSetupWizardStateV2 extends DesktopSetupWizardVersions {
  readonly version: 2
  readonly profileHash: string
  readonly outcome: DesktopSetupWizardOutcome
  readonly recordedAt: string
}

export type DesktopSetupWizardState = DesktopSetupWizardStateV1 | DesktopSetupWizardStateV2

function invalid(message: string): Error {
  return new Error(`${BIN_NAME}: invalid Desktop Setup Wizard state: ${message}`)
}

function assertCanonicalVersion(label: string, value: unknown, error: (message: string) => Error): string {
  if (typeof value !== 'string') throw error(`${label} must be a canonical Semantic Version`)
  const parsed = parseSemVer(value)
  if (parsed === null || parsed.version !== value) {
    throw error(`${label} must be a canonical Semantic Version`)
  }
  return value
}

function assertSetupRevision(value: unknown, error: (message: string) => Error): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw error('setupRevision must be a positive safe integer')
  }
  return value
}

function assertRecordedAt(value: unknown): string {
  if (typeof value !== 'string') throw invalid('recordedAt must be a canonical ISO timestamp')
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw invalid('recordedAt must be a canonical ISO timestamp')
  }
  return value
}

function normalizedVersions(value: DesktopSetupWizardVersions): DesktopSetupWizardVersions {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${BIN_NAME}: Setup Wizard versions must be an object`)
  }
  const error = (message: string) => new TypeError(`${BIN_NAME}: invalid Setup Wizard versions: ${message}`)
  return Object.freeze({
    desktopVersion: assertCanonicalVersion('desktopVersion', value.desktopVersion, error),
    dshVersion: assertCanonicalVersion('dshVersion', value.dshVersion, error),
    setupRevision: assertSetupRevision(value.setupRevision, error),
  })
}

function assertAbsolutePath(label: string, value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0') || !isAbsolute(value)) {
    throw new TypeError(`${BIN_NAME}: ${label} must be an absolute path without NUL`)
  }
  return resolve(value)
}

/** Stable Profile identity used only as a private user-data path component. */
export function desktopSetupWizardProfileHash(profileDir: string): string {
  const normalized = assertAbsolutePath('Setup Wizard Profile directory', profileDir)
  return createHash('sha256').update(normalized).digest('hex')
}

/** Fixed marker path for one Profile under one Electron user-data directory. */
export function desktopSetupWizardStatePath(userDataDir: string, profileDir: string): string {
  const userData = assertAbsolutePath('Setup Wizard user-data directory', userDataDir)
  const profileHash = desktopSetupWizardProfileHash(profileDir)
  return join(userData, STATE_ROOT_DIRECTORY, profileHash, STATE_FILENAME)
}

function assertDirectory(path: string): void {
  const info = lstatSync(path)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw invalid(`state directory must be a real directory: ${path}`)
  }
}

function ensureDirectory(path: string): void {
  mkdirSync(path, { recursive: true })
  const info = lstatSync(path)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw invalid(`state directory must be a real directory: ${path}`)
  }
}

function existingPathInfo(path: string): Stats | undefined {
  try {
    return lstatSync(path)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw cause
  }
}

function assertSafeStateTarget(path: string): void {
  const info = existingPathInfo(path)
  if (info === undefined) return
  if (!info.isFile() || info.isSymbolicLink()) throw invalid('marker must be a regular file')
  if (info.size > MAX_STATE_BYTES) {
    throw invalid(`marker exceeds ${String(MAX_STATE_BYTES)} bytes`)
  }
}

function readStateBytes(path: string): string | undefined {
  const pathInfo = existingPathInfo(path)
  if (pathInfo === undefined) return undefined
  if (!pathInfo.isFile() || pathInfo.isSymbolicLink()) throw invalid('marker must be a regular file')
  if (pathInfo.size > MAX_STATE_BYTES) {
    throw invalid(`marker exceeds ${String(MAX_STATE_BYTES)} bytes`)
  }

  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const descriptorInfo = fstatSync(descriptor)
    if (!descriptorInfo.isFile() || descriptorInfo.size > MAX_STATE_BYTES) {
      throw invalid(`marker must be a regular file within ${String(MAX_STATE_BYTES)} bytes`)
    }
    if (descriptorInfo.dev !== pathInfo.dev || descriptorInfo.ino !== pathInfo.ino) {
      throw invalid('marker changed while it was being opened')
    }
    const buffer = Buffer.alloc(MAX_STATE_BYTES + 1)
    let bytesRead = 0
    while (bytesRead < buffer.byteLength) {
      const count = readSync(descriptor, buffer, bytesRead, buffer.byteLength - bytesRead, null)
      if (count === 0) break
      bytesRead += count
    }
    if (bytesRead > MAX_STATE_BYTES) {
      throw invalid(`marker exceeds ${String(MAX_STATE_BYTES)} bytes`)
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead))
    } catch {
      throw invalid('marker must contain valid UTF-8')
    }
  } finally {
    closeSync(descriptor)
  }
}

function parseState(text: string, expectedProfileHash: string): DesktopSetupWizardState {
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch {
    throw invalid('marker must contain valid JSON')
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid('marker root must be an object')
  }
  const object = value as Record<string, unknown>
  const keys = Object.keys(object).sort()
  const legacy = object.version === LEGACY_STATE_VERSION
  const expectedKeys = legacy
    ? ['outcome', 'profileHash', 'version']
    : ['desktopVersion', 'dshVersion', 'outcome', 'profileHash', 'recordedAt', 'setupRevision', 'version']
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw invalid('marker contains unexpected fields')
  }
  if (!legacy && object.version !== STATE_VERSION) throw invalid('marker has an unsupported version')
  if (typeof object.profileHash !== 'string' || !HASH_PATTERN.test(object.profileHash)
    || object.profileHash !== expectedProfileHash) {
    throw invalid('marker Profile identity does not match its path')
  }
  if (object.outcome !== 'completed' && object.outcome !== 'skipped') {
    throw invalid('marker outcome must be completed or skipped')
  }
  if (legacy) {
    return Object.freeze({
      version: LEGACY_STATE_VERSION,
      profileHash: object.profileHash,
      outcome: object.outcome,
    })
  }
  return Object.freeze({
    version: STATE_VERSION,
    profileHash: object.profileHash,
    outcome: object.outcome,
    desktopVersion: assertCanonicalVersion('desktopVersion', object.desktopVersion, invalid),
    dshVersion: assertCanonicalVersion('dshVersion', object.dshVersion, invalid),
    setupRevision: assertSetupRevision(object.setupRevision, invalid),
    recordedAt: assertRecordedAt(object.recordedAt),
  })
}

/** Read one Profile marker; absence means the Wizard still needs a decision. */
export function readDesktopSetupWizardState(
  userDataDir: string,
  profileDir: string,
): DesktopSetupWizardState | undefined {
  const path = desktopSetupWizardStatePath(userDataDir, profileDir)
  const root = dirname(dirname(path))
  const profileRoot = dirname(path)
  if (existingPathInfo(root) === undefined) return undefined
  assertDirectory(root)
  if (existingPathInfo(profileRoot) === undefined) return undefined
  assertDirectory(profileRoot)
  const text = readStateBytes(path)
  if (text === undefined) return undefined
  return parseState(text, desktopSetupWizardProfileHash(profileDir))
}

/** Setup is a one-time Profile decision; recorded versions are diagnostic only. */
export function desktopSetupWizardRequired(
  state: DesktopSetupWizardState | undefined,
  currentVersions: DesktopSetupWizardVersions,
): boolean {
  normalizedVersions(currentVersions)
  return state === undefined
}

/** Atomically record explicit completion or an explicit skip for one Profile. */
export async function completeOrSkipDesktopSetupWizard(
  userDataDir: string,
  profileDir: string,
  outcome: DesktopSetupWizardOutcome,
  currentVersions: DesktopSetupWizardVersions,
  recordedAt: string = new Date().toISOString(),
): Promise<DesktopSetupWizardStateV2> {
  if (outcome !== 'completed' && outcome !== 'skipped') {
    throw new TypeError(`${BIN_NAME}: invalid Desktop Setup Wizard outcome`)
  }
  const path = desktopSetupWizardStatePath(userDataDir, profileDir)
  const profileHash = desktopSetupWizardProfileHash(profileDir)
  const versions = normalizedVersions(currentVersions)
  const canonicalRecordedAt = assertRecordedAt(recordedAt)
  ensureDirectory(dirname(dirname(path)))
  ensureDirectory(dirname(path))
  const state: DesktopSetupWizardStateV2 = Object.freeze({
    version: STATE_VERSION,
    profileHash,
    outcome,
    ...versions,
    recordedAt: canonicalRecordedAt,
  })
  // The launcher holds Electron's single-instance lock before this path is
  // reachable. Atomic replacement is sufficient here and, unlike a sibling
  // writer lock, cannot strand first-run Setup after an interrupted process.
  assertSafeStateTarget(path)
  const current = readStateBytes(path)
  if (current !== undefined) parseState(current, profileHash)
  await writeFileAtomic(path, `${JSON.stringify(state, undefined, 2)}\n`, { mode: 0o666 })
  return state
}

/** Clear one Profile marker without touching any other Profile's decision. */
export function clearDesktopSetupWizardStateSync(
  userDataDir: string,
  profileDir: string,
): void {
  const path = desktopSetupWizardStatePath(userDataDir, profileDir)
  if (existingPathInfo(dirname(dirname(path))) === undefined) return
  assertDirectory(dirname(dirname(path)))
  if (existingPathInfo(dirname(path)) === undefined) return
  assertDirectory(dirname(path))
  const info = existingPathInfo(path)
  if (info === undefined) return
  assertSafeStateTarget(path)
  unlinkSync(path)
}

/** Promise-compatible wrapper retained for existing asynchronous cleanup callers. */
export async function clearDesktopSetupWizardState(
  userDataDir: string,
  profileDir: string,
): Promise<void> {
  clearDesktopSetupWizardStateSync(userDataDir, profileDir)
}

export const desktopSetupWizardStateConstants = Object.freeze({
  version: STATE_VERSION,
  legacyVersion: LEGACY_STATE_VERSION,
  setupRevision: SETUP_REVISION,
  rootDirectory: STATE_ROOT_DIRECTORY,
  filename: STATE_FILENAME,
  maxBytes: MAX_STATE_BYTES,
})
