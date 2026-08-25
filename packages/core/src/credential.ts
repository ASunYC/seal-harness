export interface CredentialRequest {
  readonly provider: string;
  readonly name: string;
  readonly signal?: AbortSignal;
}

export interface CredentialService {
  resolve(request: CredentialRequest): Promise<string | undefined>;
}
