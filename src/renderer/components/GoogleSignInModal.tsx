import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { desktopAPI } from '../api.js';
import { AuthAccountProfile, DeviceAuthStartResult } from '../types.js';

interface GoogleSignInModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSignedIn: (account: AuthAccountProfile) => void;
}

type ModalStatus = 'loading' | 'ready' | 'authorized' | 'error';

export const GoogleSignInModal: React.FC<GoogleSignInModalProps> = ({
  isOpen,
  onClose,
  onSignedIn,
}) => {
  const [status, setStatus] = useState<ModalStatus>('loading');
  const [authData, setAuthData] = useState<DeviceAuthStartResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [remainingSec, setRemainingSec] = useState<number>(0);

  const pollTimerRef = useRef<number | null>(null);
  const countdownTimerRef = useRef<number | null>(null);
  const copiedTimerRef = useRef<number | null>(null);
  const mountedRef = useRef<boolean>(false);

  const clearAllTimers = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (countdownTimerRef.current !== null) {
      window.clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    if (copiedTimerRef.current !== null) {
      window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = null;
    }
  }, []);

  const startAuthFlow = useCallback(async () => {
    clearAllTimers();
    setStatus('loading');
    setErrorMsg('');
    setAuthData(null);
    setCopied(false);

    try {
      const start = await desktopAPI.startDeviceAuth();
      if (!mountedRef.current) return;

      setAuthData(start);
      setRemainingSec(start.expiresInSec || 1800);
      setStatus('ready');

      countdownTimerRef.current = window.setInterval(() => {
        setRemainingSec((prev) => {
          if (prev <= 1) {
            clearAllTimers();
            setStatus('error');
            setErrorMsg('Mã xác thực đã hết hạn. Vui lòng lấy mã mới.');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      let intervalMs = Math.max(3000, (start.intervalSec || 5) * 1000);

      const pollTick = async () => {
        if (!mountedRef.current) return;
        try {
          const poll = await desktopAPI.pollDeviceAuth(start.deviceCode);
          if (!mountedRef.current) return;

          if (poll.status === 'authorized' && poll.account) {
            clearAllTimers();
            setStatus('authorized');
            const account = poll.account;
            window.setTimeout(() => {
              if (!mountedRef.current) return;
              onSignedIn(account);
              onClose();
            }, 650);
            return;
          }

          if (poll.status === 'expired') {
            clearAllTimers();
            setStatus('error');
            setErrorMsg('Mã thiết bị đã hết hạn. Nhấn "Lấy mã mới" để thử lại.');
            return;
          }

          if (poll.status === 'denied') {
            clearAllTimers();
            setStatus('error');
            setErrorMsg('Bạn đã từ chối cấp quyền đăng nhập.');
            return;
          }

          if (poll.status === 'error') {
            clearAllTimers();
            setStatus('error');
            setErrorMsg(poll.error || 'Xác thực Google thất bại. Vui lòng thử lại.');
            return;
          }

          if (poll.status === 'slow_down') {
            intervalMs = Math.min(intervalMs + 2500, 15000);
          }
        } catch {
          // Giữ nguyên vòng lặp nếu mạng chập chờn tạm thời trong lúc người dùng đang thao tác ở trình duyệt
        }

        if (mountedRef.current) {
          pollTimerRef.current = window.setTimeout(pollTick, intervalMs);
        }
      };

      pollTimerRef.current = window.setTimeout(pollTick, intervalMs);
    } catch (err: any) {
      if (!mountedRef.current) return;
      setStatus('error');
      setErrorMsg(err?.message || String(err) || 'Không thể kết nối máy chủ Google.');
    }
  }, [clearAllTimers, onClose, onSignedIn]);

  useEffect(() => {
    mountedRef.current = isOpen;
    if (isOpen) {
      startAuthFlow();
    } else {
      clearAllTimers();
    }
    return () => {
      mountedRef.current = false;
      clearAllTimers();
    };
  }, [isOpen, startAuthFlow, clearAllTimers]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const verificationUrl = authData?.verificationUrl || 'https://www.google.com/device';

  const handleCopyCode = async () => {
    if (!authData?.userCode) return;
    try {
      await navigator.clipboard.writeText(authData.userCode);
      setCopied(true);
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
      copiedTimerRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked fallback ignored
    }
  };

  const handleOpenBrowser = async () => {
    try {
      await desktopAPI.openExternalUrl(verificationUrl);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể mở trình duyệt ngoài. Vui lòng tự truy cập URL.');
    }
  };

  const formatCountdown = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="google-signin-title"
    >
      <div
        className="w-full max-w-md bg-[#141414] border border-white/10 rounded-[12px] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-yt-border bg-[#101010]">
          <h2 id="google-signin-title" className="text-base font-bold text-white">
            Đăng nhập tài khoản Google
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-[8px] text-yt-subtext hover:text-white hover:bg-yt-hover transition-colors"
            title="Đóng (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5">
          {status === 'loading' && (
            <div className="py-10 flex flex-col items-center justify-center space-y-3">
              <div className="w-10 h-10 border-4 border-yt-red border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-yt-subtext">Đang tạo mã liên kết thiết bị từ Google...</p>
            </div>
          )}

          {status === 'ready' && authData && (
            <>
              <div className="space-y-2 text-xs text-yt-subtext leading-relaxed">
                <p>
                  <span className="text-white font-semibold">Bước 1:</span> Mở trang kích hoạt của Google trên trình duyệt:
                </p>
                <div className="flex items-center justify-between gap-2 bg-[#0b0b0b] border border-yt-border rounded-[8px] px-3 py-2">
                  <span className="text-sm font-mono text-white truncate select-text">
                    {verificationUrl}
                  </span>
                  <button
                    type="button"
                    onClick={handleOpenBrowser}
                    className="flex items-center space-x-1.5 px-3 py-2 min-h-[44px] bg-yt-red hover:bg-red-700 text-white text-xs font-semibold rounded-[8px] flex-shrink-0 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Mở trình duyệt</span>
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs text-yt-subtext">
                  <span className="text-white font-semibold">Bước 2:</span> Nhập mã thiết bị sau vào trang vừa mở và chọn tài khoản YouTube của bạn:
                </p>
                <div className="bg-[#0b0b0b] border border-white/10 rounded-[10px] p-4 flex items-center justify-between gap-3">
                  <span className="text-2xl font-mono font-bold tracking-[0.18em] text-white select-text">
                    {authData.userCode}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className={`flex items-center space-x-1.5 px-3.5 py-2 min-h-[44px] rounded-[8px] text-xs font-semibold border transition-colors ${
                      copied
                        ? 'bg-emerald-600/20 text-emerald-300 border-emerald-500/40'
                        : 'bg-yt-card hover:bg-yt-hover text-white border-white/10'
                    }`}
                  >
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    <span>{copied ? 'Đã sao chép' : 'Sao chép mã'}</span>
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-yt-border text-xs text-yt-subtext">
                <div className="flex items-center space-x-2">
                  <span className="w-2 h-2 rounded-full bg-yt-red animate-pulse" />
                  <span>Đang chờ xác nhận từ Google...</span>
                </div>
                <span className="font-mono text-white/80">
                  Còn {formatCountdown(remainingSec)}
                </span>
              </div>
            </>
          )}

          {status === 'authorized' && (
            <div className="py-10 flex flex-col items-center justify-center space-y-3 text-center">
              <CheckCircle2 className="w-12 h-12 text-emerald-400" />
              <p className="text-base font-bold text-white">Đăng nhập thành công!</p>
              <p className="text-xs text-yt-subtext">Đang đồng bộ Kênh đăng ký, Lịch sử và Xem sau...</p>
            </div>
          )}

          {status === 'error' && (
            <div className="py-6 flex flex-col items-center justify-center space-y-4 text-center">
              <AlertCircle className="w-10 h-10 text-yt-red" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-white">Không thể hoàn tất đăng nhập</p>
                <p className="text-xs text-yt-subtext max-w-sm">{errorMsg}</p>
              </div>
              <button
                type="button"
                onClick={startAuthFlow}
                className="flex items-center space-x-2 px-4 py-2 min-h-[44px] bg-yt-red hover:bg-red-700 text-white text-xs font-semibold rounded-[8px] transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Lấy mã mới</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
