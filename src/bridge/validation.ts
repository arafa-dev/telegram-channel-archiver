export interface GetHistoryArgs {
  peerId: number;
  offsetId: number;
  limit: number;
}

export interface ExtractMediaRefArgs {
  message: any;
}

export interface DownloadMediaArgs {
  rawMediaToken: string;
  fileName: string;
  requestId: number;
}

export interface ReleaseMediaTokenArgs {
  rawMediaToken: string;
}

export function parseGetHistoryArgs(args: unknown): GetHistoryArgs {
  if (!isRecord(args)) throwInvalidArgs();
  const { peerId, offsetId, limit } = args;

  if (
    !Number.isFinite(peerId) ||
    !Number.isInteger(peerId) ||
    !Number.isFinite(offsetId) ||
    !Number.isInteger(offsetId) ||
    offsetId < 0 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 200
  ) {
    throwInvalidArgs();
  }

  return { peerId, offsetId, limit };
}

export function parseExtractMediaRefArgs(args: unknown): ExtractMediaRefArgs {
  if (!isRecord(args) || !isRecord(args.message)) throwInvalidArgs();
  return { message: args.message };
}

export function parseDownloadMediaArgs(args: unknown): DownloadMediaArgs {
  if (!isRecord(args)) throwInvalidArgs();
  const { rawMediaToken, fileName, requestId } = args;

  if (
    typeof rawMediaToken !== 'string' ||
    typeof fileName !== 'string' ||
    fileName.length === 0 ||
    !Number.isFinite(requestId) ||
    !Number.isInteger(requestId)
  ) {
    throwInvalidArgs();
  }

  return { rawMediaToken, fileName, requestId };
}

export function parseReleaseMediaTokenArgs(args: unknown): ReleaseMediaTokenArgs {
  if (!isRecord(args) || typeof args.rawMediaToken !== 'string') throwInvalidArgs();
  return { rawMediaToken: args.rawMediaToken };
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null;
}

function throwInvalidArgs(): never {
  throw new Error('INVALID_ARGS');
}
