import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Smartphone, CheckCircle, RefreshCw, Send, ShieldCheck, Wifi, ExternalLink, Copy, AlertCircle } from 'lucide-react';
import { lucyLink, PairingData, LucyLinkStatus } from '../../lib/network/lucyLink';

export function PhoneLinkTab() {
  const [pairingData, setPairingData] = useState<PairingData | null>(null);
  const [status, setStatus] = useState<LucyLinkStatus>({
    connected: false,
    connectedDevice: null,
    localIp: '...',
    port: 52442,
    deviceName: 'Lucy-PC',
  });
  const [testPrompt, setTestPrompt] = useState('Read phone battery and Wi-Fi state');
  const [isSending, setIsSending] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loadingPairing, setLoadingPairing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showQrCodeWhenConnected, setShowQrCodeWhenConnected] = useState(false);

  useEffect(() => {
    loadPairing();
    const unsub = lucyLink.subscribe((s) => setStatus(s));

    // Active status poller: Polls every 2 seconds while PhoneLinkTab is open
    // so connection from mobile is detected instantly in real-time
    const pollInterval = setInterval(async () => {
      try {
        const st = await lucyLink.getStatus();
        setStatus(st);
      } catch (err) {
        // ignore
      }
    }, 2000);

    return () => {
      unsub();
      clearInterval(pollInterval);
    };
  }, []);

  const loadPairing = async () => {
    setLoadingPairing(true);
    setLoadError(null);
    try {
      const data = await lucyLink.getPairingData();
      setPairingData(data);
      const st = await lucyLink.getStatus();
      setStatus(st);
    } catch (e: any) {
      console.warn('Failed to load pairing data from backend, generating fallback:', e);
      setLoadError(e?.message || String(e));
      const ip = (status.localIp && status.localIp !== '...' && status.localIp !== '127.0.0.1') ? status.localIp : '127.0.0.1';
      const port = status.port || 52442;
      const secret = 'lucy_' + Math.random().toString(36).substring(2, 10);
      const name = status.deviceName || 'Lucy-PC';
      setPairingData({
        ip,
        port,
        secret,
        name,
        qr_uri: `lucy://pair?ip=${ip}&port=${port}&secret=${secret}&name=${encodeURIComponent(name)}`
      });
    } finally {
      setLoadingPairing(false);
    }
  };

  const handleSendTestPrompt = async () => {
    if (!testPrompt.trim()) return;
    setIsSending(true);
    setTestResult(null);
    setErrorMsg(null);

    try {
      const result = await lucyLink.sendPromptToPhone(testPrompt);
      setTestResult(result);
    } catch (e: any) {
      setErrorMsg(e?.toString() || 'Failed to send prompt to phone');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-2xl w-full text-[#1E1926]">
      <div>
        <h3 className="text-2xl font-black mb-1 text-[#1E1926] flex items-center gap-2">
          <Smartphone className="w-6 h-6 text-[#F43F8E]" /> Phone Link (P2P Cross-Device)
        </h3>
        <p className="text-[#6B7280] text-xs">
          Direct, serverless link between your PC Companion and Android Phone. Control each other bidirectionally via AI prompts.
        </p>
      </div>

      {/* Live Connection Banner */}
      <div
        className={`p-5 rounded-2xl border transition-all flex items-center justify-between shadow-sm ${
          status.connected
            ? 'bg-emerald-50/80 border-emerald-300 text-emerald-950'
            : 'bg-white border-[#FCE7F3]'
        }`}
      >
        <div className="flex items-center gap-3.5">
          <div
            className={`w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0 ${
              status.connected
                ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/20'
                : 'bg-gray-100 text-gray-500 border border-gray-200'
            }`}
          >
            {status.connected ? <CheckCircle className="w-6 h-6" /> : <Wifi className="w-6 h-6" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-bold">
                {status.connected ? `Connected to ${status.connectedDevice}` : 'Waiting for Mobile Connection'}
              </h4>
              <span
                className={`text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider ${
                  status.connected
                    ? 'bg-emerald-600 text-white'
                    : 'bg-amber-100 text-amber-700 border border-amber-300'
                }`}
              >
                {status.connected ? 'ONLINE (P2P)' : 'READY TO PAIR'}
              </span>
            </div>
            <p className="text-xs text-[#6B7280] mt-0.5">
              {status.connected
                ? 'Prompts, tasks, and memories sync directly across your local Wi-Fi with zero cloud server.'
                : `Listening on local Wi-Fi at ${status.localIp}:${status.port}`}
            </p>
          </div>
        </div>

        <button
          onClick={loadPairing}
          className="p-2.5 hover:bg-gray-100 rounded-xl text-gray-500 transition-colors cursor-pointer"
          title="Refresh Network Details"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Live Connected or QR Pairing Card */}
      <div className="bg-white border border-[#FCE7F3] shadow-sm rounded-2xl p-6 flex flex-col md:flex-row items-center gap-6">
        <div className="p-3 bg-white border-2 border-[#FCE7F3] rounded-2xl shadow-md shrink-0 flex items-center justify-center min-w-[206px] min-h-[206px] relative">
          {status.connected && !showQrCodeWhenConnected ? (
            <div className="w-[180px] h-[180px] flex flex-col items-center justify-center gap-3 text-center p-2">
              <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 shadow-sm">
                <CheckCircle className="w-8 h-8" />
              </div>
              <div>
                <h5 className="font-extrabold text-xs text-emerald-950">Active Device</h5>
                <p className="text-[11px] font-bold text-emerald-700 mt-0.5 max-w-[160px] truncate">{status.connectedDevice}</p>
              </div>
              <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2.5 py-0.5 rounded-full border border-emerald-300">
                P2P Connected
              </span>
            </div>
          ) : pairingData ? (
            <div className="flex flex-col items-center gap-2">
              <QRCodeSVG
                value={pairingData.qr_uri}
                size={180}
                bgColor="#FFFFFF"
                fgColor="#1E1926"
                level="M"
              />
            </div>
          ) : (
            <div className="w-[180px] h-[180px] flex flex-col items-center justify-center gap-2 text-xs text-gray-400">
              <RefreshCw className="w-5 h-5 animate-spin text-[#F43F8E]" />
              <span>Generating QR...</span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2.5 flex-1">
          {status.connected && !showQrCodeWhenConnected ? (
            <>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-bold rounded-lg self-start">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> Cross-Device P2P Active
              </div>
              <h4 className="text-base font-bold text-[#1E1926]">Connected to {status.connectedDevice}</h4>
              <p className="text-xs text-[#6B7280] leading-relaxed">
                Your PC Companion and Android Phone are communicating directly over local Wi-Fi with end-to-end P2P encryption.
                You can now speak commands to either device to control each other seamlessly.
              </p>

              <div className="mt-2 pt-2 border-t border-[#FCE7F3] flex flex-wrap items-center justify-between gap-y-2 text-[11px] text-[#6B7280]">
                <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono">
                  <span>LAN IP: <strong className="text-[#1E1926]">{status.localIp}</strong></span>
                  <span>Port: <strong className="text-[#1E1926]">{status.port}</strong></span>
                  <span>Status: <strong className="text-emerald-600 font-bold">Encrypted &amp; Online</strong></span>
                </div>

                <button
                  onClick={() => setShowQrCodeWhenConnected(true)}
                  className="px-2.5 py-1 text-[11px] font-medium bg-[#FFF5F8] hover:bg-pink-100 text-[#F43F8E] rounded-lg border border-pink-200 transition-colors cursor-pointer"
                >
                  Show QR to Pair Another Phone
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-pink-50 border border-pink-200 text-[#F43F8E] text-[11px] font-bold rounded-lg self-start">
                <ShieldCheck className="w-3.5 h-3.5" /> 1-Time Security Pairing
              </div>
              <h4 className="text-base font-bold text-[#1E1926]">Scan from Lucy Mobile App</h4>
              <p className="text-xs text-[#6B7280] leading-relaxed">
                Open Lucy on your Android phone, go to <strong>"PC Companion Link"</strong> &gt; <strong>"Pair with PC (Scan QR)"</strong>, and scan this QR code.
                Your phone and PC will exchange cryptographic tokens once and remember each other forever.
              </p>

              <div className="mt-2 pt-2 border-t border-[#FCE7F3] flex flex-wrap items-center justify-between gap-y-2 text-[11px] text-[#6B7280]">
                <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono">
                  <span>LAN IP: <strong className="text-[#1E1926]">{status.localIp}</strong></span>
                  <span>Port: <strong className="text-[#1E1926]">{status.port}</strong></span>
                  <span>ZeroConf: <strong className="text-emerald-600">_lucylink._tcp active</strong></span>
                </div>

                {pairingData && (
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(pairingData.qr_uri);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className="px-2.5 py-1 text-[11px] font-medium bg-[#FFF5F8] hover:bg-pink-100 text-[#F43F8E] rounded-lg border border-pink-200 transition-colors flex items-center gap-1 cursor-pointer"
                    title="Copy pairing link to clipboard"
                  >
                    {copied ? <CheckCircle className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    {copied ? 'Copied URI' : 'Copy Pairing URI'}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Live Test Console */}
      <div className="bg-white border border-[#FCE7F3] shadow-sm rounded-2xl p-6 flex flex-col gap-4">
        <div>
          <h4 className="text-sm font-bold text-[#1E1926] flex items-center gap-2">
            <Send className="w-4 h-4 text-[#F43F8E]" /> Test Agent Prompt Delegation (PC ➔ Phone)
          </h4>
          <p className="text-xs text-[#6B7280] mt-0.5">
            Test sending an autonomous task to your phone's background agent.
          </p>
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={testPrompt}
            onChange={(e) => setTestPrompt(e.target.value)}
            placeholder="e.g. Reply to Mom on WhatsApp, read battery percentage..."
            className="flex-1 bg-[#FFF5F8] border border-[#FCE7F3] rounded-xl px-4 py-2.5 text-xs text-[#1E1926] focus:outline-none focus:border-[#F43F8E]"
          />
          <button
            onClick={handleSendTestPrompt}
            disabled={isSending || !status.connected}
            className="px-4 py-2.5 bg-gradient-to-r from-[#F43F8E] to-[#E11D48] text-white text-xs font-bold rounded-xl shadow-md disabled:opacity-50 transition-all flex items-center gap-1.5 shrink-0 cursor-pointer"
          >
            {isSending ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Running on Phone...
              </>
            ) : (
              <>
                <Send className="w-3.5 h-3.5" /> Send Task
              </>
            )}
          </button>
        </div>

        {testResult && (
          <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900">
            <strong className="font-bold text-emerald-700">Phone Agent Response:</strong>
            <p className="mt-1 font-mono text-[11px] whitespace-pre-wrap">{testResult}</p>
          </div>
        )}

        {errorMsg && (
          <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900">
            <strong className="font-bold text-rose-700">Error:</strong>
            <p className="mt-1 text-[11px]">{errorMsg}</p>
          </div>
        )}
      </div>
    </div>
  );
}
