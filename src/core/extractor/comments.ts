import { InnerTubeService, defaultInnerTube } from '../clients/innertube.js';
import { CLIENT_CONFIGS } from '../clients/client-configs.js';

export interface VideoComment {
  id: string;
  author: string;
  authorAvatar?: string;
  channelId?: string;
  text: string;
  likes: number;
  publishedText?: string;
  pinned: boolean;
  replyCount: number;
}

export interface CommentsResult {
  comments: VideoComment[];
  totalCount: number;
  disabled: boolean;
  continuationToken?: string;
}

export class CommentsExtractor {
  private innertube: InnerTubeService;

  constructor(innertube: InnerTubeService = defaultInnerTube) {
    this.innertube = innertube;
  }

  /**
   * Fetches the first page of comments for a video
   */
  async getComments(videoId: string): Promise<CommentsResult> {
    try {
      // 1. First call 'next' to get the comment section continuation token
      const nextResp = await this.innertube.request(
        'next',
        {
          videoId,
        },
        CLIENT_CONFIGS.WEB
      );

      const token = this.findCommentContinuationToken(nextResp);
      if (!token) {
        return { comments: [], totalCount: 0, disabled: false };
      }

      // 2. Fetch comments page using continuation token
      const commentsResp = await this.innertube.request(
        'next',
        {
          continuation: token,
        },
        CLIENT_CONFIGS.WEB
      );

      return this.parseCommentsPage(commentsResp);
    } catch {
      return { comments: [], totalCount: 0, disabled: false };
    }
  }

  private findCommentContinuationToken(nextResp: any): string | null {
    let token: string | null = null;

    const walk = (obj: any) => {
      if (!obj || typeof obj !== 'object' || token) return;
      if (obj.sectionIdentifier === 'comment-item-section' || obj.targetId === 'comments-section') {
        const continuation = obj.contents?.[0]?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
        if (continuation) {
          token = continuation;
          return;
        }
      }
      for (const key of Object.keys(obj)) {
        walk(obj[key]);
      }
    };

    walk(nextResp);
    return token;
  }

  private parseCommentsPage(json: any): CommentsResult {
    const comments: VideoComment[] = [];
    let totalCount = 0;
    let continuationToken: string | undefined;

    const walk = (obj: any) => {
      if (!obj || typeof obj !== 'object') return;

      // Header with comment count
      if (obj.commentsHeaderRenderer) {
        const countText =
          obj.commentsHeaderRenderer.countText?.runs?.map((r: any) => r.text).join('') ||
          obj.commentsHeaderRenderer.countText?.simpleText ||
          '0';
        const num = parseInt(countText.replace(/\D/g, ''), 10);
        if (!isNaN(num)) totalCount = num;
      }

      // Individual comment thread renderer
      if (obj.commentThreadRenderer) {
        const commentRenderer =
          obj.commentThreadRenderer.comment?.commentRenderer ||
          obj.commentThreadRenderer.commentViewModel?.commentViewModel;

        if (commentRenderer) {
          const parsed = this.parseSingleComment(commentRenderer);
          if (parsed) comments.push(parsed);
        }
      }

      // Continuation for next page of comments
      if (obj.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token) {
        continuationToken = obj.continuationItemRenderer.continuationEndpoint.continuationCommand.token;
      }

      for (const key of Object.keys(obj)) {
        walk(obj[key]);
      }
    };

    walk(json);

    return {
      comments: comments.filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i),
      totalCount: Math.max(totalCount, comments.length),
      disabled: false,
      continuationToken,
    };
  }

  private parseSingleComment(renderer: any): VideoComment | null {
    const id = renderer.commentId || renderer.properties?.commentId;
    if (!id) return null;

    const author =
      renderer.authorText?.simpleText ||
      renderer.author?.displayName ||
      renderer.authorText?.runs?.map((r: any) => r.text).join('') ||
      'Người dùng ẩn danh';

    const authorAvatar =
      renderer.authorThumbnail?.thumbnails?.[0]?.url ||
      renderer.author?.avatarThumbnailUrl;

    const channelId =
      renderer.authorEndpoint?.browseEndpoint?.browseId ||
      renderer.author?.channelId;

    const text =
      renderer.contentText?.runs?.map((r: any) => r.text).join('') ||
      renderer.contentText?.simpleText ||
      renderer.properties?.content?.content ||
      '';

    const likesText =
      renderer.voteCount?.simpleText ||
      renderer.toolbar?.likeCountNotliked ||
      '0';
    const likes = parseInt(likesText.replace(/\D/g, ''), 10) || 0;

    const publishedText =
      renderer.publishedTimeText?.runs?.map((r: any) => r.text).join('') ||
      renderer.properties?.publishedTime;

    const pinned = Boolean(renderer.pinnedTextList || renderer.properties?.pinnedText);
    const replyCount = Number(renderer.replyCount || renderer.toolbar?.replyCount || 0);

    return {
      id,
      author,
      authorAvatar: authorAvatar?.startsWith('//') ? `https:${authorAvatar}` : authorAvatar,
      channelId,
      text,
      likes,
      publishedText,
      pinned,
      replyCount,
    };
  }
}

export const defaultCommentsExtractor = new CommentsExtractor();
