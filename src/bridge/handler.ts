import type { ReqEnvelope } from '../shared/envelope';
import { encodeEvt } from '../shared/envelope';
import { downloadMedia } from './download';
import { getHistory } from './history';
import { extractMessage, releaseMediaToken, resolveMediaToken } from './media';
import { getCurrentPeer } from './peer';
import type { TelegramHandles } from './resolve';
import { parseDownloadMediaArgs, parseExtractMediaRefArgs, parseGetHistoryArgs, parseReleaseMediaTokenArgs } from './validation';

export type BridgePostMessage = (message: unknown, targetOrigin: string) => void;

export async function handleBridgeReq(
  req: ReqEnvelope,
  handles: TelegramHandles,
  postMessage: BridgePostMessage = window.postMessage.bind(window)
): Promise<unknown> {
  switch (req.op) {
    case 'ping':
      return { ready: true };

    case 'getCurrentPeer':
      return getCurrentPeer(handles);

    case 'getHistory': {
      const args = parseGetHistoryArgs(req.args);
      const page = await getHistory(handles, args.peerId, args.offsetId, args.limit);
      return {
        messages: page.messages.map((m) => extractMessage(m)),
        nextOffsetId: page.nextOffsetId,
      };
    }

    case 'extractMediaRef': {
      const args = parseExtractMediaRefArgs(req.args);
      return extractMessage(args.message);
    }

    case 'downloadMedia': {
      const args = parseDownloadMediaArgs(req.args);
      const rawMedia = resolveMediaToken(args.rawMediaToken);

      const blob = await downloadMedia(handles, rawMedia, args.fileName, (loaded, total) => {
        postMessage(encodeEvt('downloadProgress', { requestId: args.requestId, loaded, total }), '*');
      });
      return { blob };
    }

    case 'releaseMediaToken': {
      const args = parseReleaseMediaTokenArgs(req.args);
      return { released: releaseMediaToken(args.rawMediaToken) };
    }
  }
}
