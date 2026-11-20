import React from 'react';
import { ThumbsUp, MessageSquare, Pin } from 'lucide-react';
import { CommentUI } from '../types.js';

interface CommentsListProps {
  comments: CommentUI[];
  totalCount: number;
  loading: boolean;
}

export const CommentsList: React.FC<CommentsListProps> = ({
  comments,
  totalCount,
  loading,
}) => {
  return (
    <div className="flex flex-col space-y-4">
      {/* Comments Header */}
      <div className="flex items-center justify-between pb-2 border-b border-yt-border">
        <h3 className="text-base font-bold text-white">
          {totalCount > 0 ? `${totalCount.toLocaleString()} Bình luận` : 'Bình luận'}
        </h3>
      </div>

      {loading && (
        <div className="py-8 text-center text-yt-subtext text-sm animate-pulse">
          Đang tải bình luận...
        </div>
      )}

      {!loading && comments.length === 0 && (
        <div className="py-8 text-center text-yt-subtext text-sm">
          Chưa có bình luận nào hoặc video đã tắt tính năng bình luận.
        </div>
      )}

      {/* List */}
      <div className="flex flex-col space-y-4">
        {comments.map((c) => (
          <div key={c.id} className="flex space-x-3 text-sm">
            {/* Author Avatar */}
            <div className="w-9 h-9 rounded-full bg-yt-hover overflow-hidden flex-shrink-0 mt-0.5">
              {c.authorAvatar ? (
                <img
                  src={c.authorAvatar}
                  alt={c.author}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center font-bold text-yt-subtext">
                  {c.author.charAt(0).toUpperCase()}
                </div>
              )}
            </div>

            {/* Comment Body */}
            <div className="flex-1 flex flex-col space-y-1">
              <div className="flex items-center space-x-2">
                <span className="font-semibold text-xs text-white">
                  {c.author}
                </span>
                {c.pinned && (
                  <span className="flex items-center text-[11px] text-yt-red bg-yt-red/10 px-1.5 py-0.2 rounded font-medium">
                    <Pin className="w-3 h-3 mr-0.5 fill-current" /> Đã ghim
                  </span>
                )}
                {c.publishedText && (
                  <span className="text-[11px] text-yt-subtext">
                    {c.publishedText}
                  </span>
                )}
              </div>

              {/* Text content */}
              <p className="text-yt-text whitespace-pre-wrap leading-relaxed text-[13px]">
                {c.text}
              </p>

              {/* Actions: Likes & Replies */}
              <div className="flex items-center space-x-4 pt-1 text-xs text-yt-subtext">
                <div className="flex items-center space-x-1 hover:text-white cursor-pointer">
                  <ThumbsUp className="w-3.5 h-3.5" />
                  {c.likes > 0 && <span>{c.likes.toLocaleString()}</span>}
                </div>
                {c.replyCount > 0 && (
                  <div className="flex items-center space-x-1 text-blue-400 hover:text-blue-300 cursor-pointer">
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>{c.replyCount} câu trả lời</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
