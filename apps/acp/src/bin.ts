#!/usr/bin/env node
import { runAcpCli } from "./cli.js";

process.exitCode = await runAcpCli(process.argv.slice(2));
