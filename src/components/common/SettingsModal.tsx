import React, { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { useController } from '../../context/ControllerContext';
import { useToast } from './Toast';
import { resolveStatusText } from '../../utils/status';
import { checkMixedContentRisk } from '../../utils/url';
import { extractVersionToken } from '../../utils/format';
import { LogLevel } from '../../types/api';
import { ApiError } from '../../services/apiClient';
import { 
  Server, 
  Key, 
  Sparkles, 
  Check, 
  RefreshCw,
  AlertTriangle, 
  Eye, 
  EyeOff,
  Sliders,
  Database,
  Trash2
} from 'lucide-react';

export function resolveRuntimeVersionToken(
  demoMode: boolean,
  rawVersion?: string | null
): string | null {
  if (demoMode) {
    const token = rawVersion ? extractVersionToken(rawVersion) : null;
    return token ? `${token} · 演示` : '演示';
  }
  if (rawVersion) {
    return extractVersionToken(rawVersion);
  }
  return null;
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const {
    baseUrl,
    secret,
    hasConfiguredController,
    hideGlobal,
    setHideGlobal,
    demoMode,
    setDemoMode,
    status,
    statusError,
    version,
    logLevel,
    setLogLevel,
    connectController,
    apiClient
  } = useController();

  const { showToast } = useToast();
  const [inputUrl, setInputUrl] = useState(baseUrl);
  const [inputSecret, setInputSecret] = useState(secret);
  const [showSecret, setShowSecret] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTogglingDemo, setIsTogglingDemo] = useState(false);
  const [isChangingLogLevel, setIsChangingLogLevel] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Cache flush states (inline confirmation instead of nested modal)
  const [confirmFlush, setConfirmFlush] = useState<'fakeip' | 'dns' | null>(null);
  const [isFlushingFakeip, setIsFlushingFakeip] = useState(false);
  const [isFlushingDns, setIsFlushingDns] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setInputUrl(baseUrl);
      setInputSecret(secret);
      setLocalError(null);
      setConfirmFlush(null);
    }
  }, [isOpen, baseUrl, secret]);

  const mixedContentRisk = checkMixedContentRisk(inputUrl);
  const isRealConnected = !demoMode && status === 'connected';

  const handleToggleDemo = async () => {
    if (isTogglingDemo || isSubmitting) return;
    const next = !demoMode;
    setIsTogglingDemo(true);
    setLocalError(null);
    try {
      const success = await setDemoMode(next);
      if (next) {
        showToast('已进入演示预览模式', 'info');
      } else if (success) {
        showToast('已退出演示模式，正在连接控制器', 'success');
      } else {
        const errorMsg = '退出演示模式失败：无法连接控制器，仍保持演示模式';
        setLocalError(errorMsg);
        showToast(errorMsg, 'error');
      }
    } catch {
      const errorMsg = '退出演示模式失败：无法连接控制器，仍保持演示模式';
      setLocalError(errorMsg);
      showToast(errorMsg, 'error');
    } finally {
      setIsTogglingDemo(false);
    }
  };

  const handleSaveAndConnect = async () => {
    if (isSubmitting || isTogglingDemo) return;
    setIsSubmitting(true);
    setLocalError(null);

    const wasDemo = demoMode;
    const targetUrl = inputUrl.trim() || 'http://127.0.0.1:9090';
    const success = await connectController(targetUrl, inputSecret);
    setIsSubmitting(false);

    if (success) {
      showToast(
        wasDemo
          ? '已退出演示模式，正在连接控制器'
          : '验证成功，正在连接控制器',
        'success'
      );
      onClose();
    } else {
      if (wasDemo) {
        const msg = '退出演示模式失败：无法连接控制器，请检查地址与密钥；仍保持演示模式';
        setLocalError(msg);
        showToast(msg, 'error');
      } else {
        setLocalError(null);
        showToast('连接失败，请检查地址、端口与密钥', 'error');
      }
    }
  };

  const handleLogLevelChange = async (level: LogLevel) => {
    if (level === logLevel) return;
    setIsChangingLogLevel(true);
    try {
      await setLogLevel(level);
      showToast(`日志级别已更新：${level.toUpperCase()}`, 'success');
    } catch (err: unknown) {
      showToast(`更新日志级别失败：${(err as Error)?.message}`, 'error');
    } finally {
      setIsChangingLogLevel(false);
    }
  };

  const handleFlushFakeip = async () => {
    setConfirmFlush(null);
    setIsFlushingFakeip(true);
    try {
      await apiClient.flushFakeipCache();
      showToast('Fake-IP 映射缓存已清空', 'success');
    } catch (err: unknown) {
      const msg = (err as Error)?.message || '清空 Fake-IP 映射缓存失败';
      showToast(msg, 'error');
    } finally {
      setIsFlushingFakeip(false);
    }
  };

  const handleFlushDns = async () => {
    setConfirmFlush(null);
    setIsFlushingDns(true);
    try {
      await apiClient.flushDnsCache();
      showToast('DNS 解析缓存已清空', 'success');
    } catch (err: unknown) {
      const apiErr = err as ApiError;
      if (apiErr?.status === 404) {
        showToast(apiErr.message || '当前内核版本不支持清空 DNS 缓存（需内核 >= v1.19.12）', 'error');
      } else {
        showToast(apiErr?.message || '清空 DNS 解析缓存失败', 'error');
      }
    } finally {
      setIsFlushingDns(false);
    }
  };

  const displayError = localError || (status === 'error' && !demoMode ? (statusError || '无法连接控制器，请检查地址、端口与密钥') : null);
  const statusLabel = resolveStatusText(status, demoMode, !!version?.version);
  const runtimeVersionToken = resolveRuntimeVersionToken(demoMode, version?.version);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="设置"
      maxWidth="560px"
      className="settings-modal-dialog"
    >
      <div className="settings-modal-body">
        {/* Onboarding copy when controller is unconfigured */}
        {!hasConfiguredController && (
          <div className="onboarding-notice-box" role="note">
            <Sparkles size={16} color="var(--accent-primary)" />
            <div className="onboarding-notice-text">
              <strong>首次使用：</strong>
              <span>填写控制器地址（密钥未设置可留空），点击 ✓ 测试并保存连接；或点击 ✨ 进入演示预览。</span>
            </div>
          </div>
        )}

        {/* ========================================================
            SECTION 1: External Controller Connection
           ======================================================== */}
        <section className="settings-modal-section" aria-labelledby="section-controller-title">
          <div className="settings-section-header">
            <div className="settings-section-title-wrap">
              <Server size={16} aria-hidden="true" />
              <h4 id="section-controller-title" className="settings-section-title">外部控制器</h4>
            </div>
          </div>

          {/* Status line with noninteractive circular status indicator */}
          <div className="modal-status-line">
            <span className="status-label">当前状态：</span>
            <div 
              className="status-circle-indicator-wrap" 
              role="status"
              aria-label={`核心状态：${statusLabel}`}
            >
              <span
                className={`status-circle-indicator status-${status} ${demoMode ? 'demo-active' : ''}`}
                aria-hidden="true"
              >
                <span className="status-dot" />
              </span>
            </div>
          </div>

          {/* Form fields */}
          <div className="form-item">
            <label className="form-label" htmlFor="modal-ctrl-url">控制器地址（API Base URL）</label>
            <div className="input-with-icon">
              <Server size={15} className="input-icon" aria-hidden="true" />
              <input
                id="modal-ctrl-url"
                type="text"
                className="meta-input form-input"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                placeholder="http://127.0.0.1:9090"
              />
            </div>
          </div>

          <div className="form-item">
            <label className="form-label" htmlFor="modal-ctrl-secret">访问密钥（Secret / Token）</label>
            <div className="input-with-icon">
              <Key size={15} className="input-icon" aria-hidden="true" />
              <input
                id="modal-ctrl-secret"
                type={showSecret ? 'text' : 'password'}
                className="meta-input form-input"
                value={inputSecret}
                onChange={(e) => setInputSecret(e.target.value)}
                placeholder="未设置可留空"
              />
              <button
                type="button"
                className="input-eye-btn"
                onClick={() => setShowSecret(!showSecret)}
                aria-label={showSecret ? '隐藏密钥' : '显示密钥'}
              >
                {showSecret ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {/* Mixed Content Warning */}
          {mixedContentRisk.hasRisk && (
            <div className="mixed-content-alert" role="alert">
              <AlertTriangle size={16} color="var(--status-amber)" aria-hidden="true" />
              <p>{mixedContentRisk.message}</p>
            </div>
          )}

          {/* Error Feedback */}
          {displayError && (
            <div className="error-feedback-alert" role="alert">
              <AlertTriangle size={16} color="var(--status-red)" aria-hidden="true" />
              <div className="error-text">
                <span>{displayError}</span>
              </div>
            </div>
          )}

          {/* Controller Actions */}
          <div className="settings-modal-actions">
            {/* Demo Toggle Action */}
            <div className="demo-toggle-action-wrap">
              <button
                type="button"
                className={`btn-circle-action size-md demo-toggle-btn ${demoMode ? 'danger' : ''}`}
                onClick={handleToggleDemo}
                disabled={isTogglingDemo || isSubmitting}
                aria-label={
                  isTogglingDemo
                    ? '正在切换演示模式…'
                    : demoMode
                    ? '退出演示模式'
                    : '进入演示预览'
                }
                data-tooltip={
                  isTogglingDemo
                    ? '正在切换演示模式…'
                    : demoMode
                    ? '退出演示模式'
                    : '进入演示预览'
                }
              >
                <Sparkles size={15} className={isTogglingDemo ? 'spin-animation' : ''} aria-hidden="true" />
              </button>
            </div>

            {/* Save/connect action on the right */}
            <div className="save-connect-action-wrap">
              <button
                type="button"
                className="btn-circle-action size-md primary-check-btn"
                onClick={handleSaveAndConnect}
                disabled={isSubmitting || isTogglingDemo}
                aria-label={isSubmitting ? '正在测试并连接…' : '测试并保存连接'}
                data-tooltip={isSubmitting ? '正在测试并连接…' : '测试并保存连接'}
              >
                {isSubmitting ? (
                  <RefreshCw size={15} className="spin-animation" aria-hidden="true" />
                ) : (
                  <Check size={16} aria-hidden="true" strokeWidth={2.5} />
                )}
              </button>
            </div>
          </div>
        </section>

        <div className="settings-section-divider" aria-hidden="true" />

        {/* ========================================================
            SECTION 2: Runtime Parameters
           ======================================================== */}
        <section className="settings-modal-section" aria-labelledby="section-runtime-title">
          <div className="settings-section-header">
            <div className="settings-section-title-wrap">
              <Sliders size={16} aria-hidden="true" />
              <h4 id="section-runtime-title" className="settings-section-title">运行参数</h4>
            </div>
            {runtimeVersionToken && (
              <span 
                className="version-tag tabular-nums" 
                data-tooltip={`核心版本：${version?.version || runtimeVersionToken}`}
                aria-label={`核心版本：${version?.version || runtimeVersionToken}`}
              >
                {runtimeVersionToken}
              </span>
            )}
          </div>

          <div className="runtime-settings-list">
            {/* Log Level */}
            <div className="runtime-setting-row runtime-setting-row-segmented">
              <div className="setting-desc">
                <span className="setting-name">核心日志等级</span>
              </div>
              <div className="mode-segmented-capsule capsule-log-levels" role="group" aria-label="核心日志等级">
                {(['info', 'warning', 'error', 'debug', 'silent'] as LogLevel[]).map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    className={`mode-capsule-item ${logLevel === lvl ? 'active' : ''}`}
                    onClick={() => handleLogLevelChange(lvl)}
                    disabled={status !== 'connected' || isChangingLogLevel}
                    aria-pressed={logLevel === lvl}
                  >
                    {lvl.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Hide GLOBAL Group */}
            <div className="runtime-setting-row runtime-setting-row-toggle">
              <div className="setting-desc">
                <label
                  htmlFor="modal-hide-global"
                  id="modal-hide-global-label"
                  className="setting-name"
                >
                  隐藏 GLOBAL 分组
                </label>
              </div>
              <label className="toggle-switch" htmlFor="modal-hide-global">
                <input
                  id="modal-hide-global"
                  type="checkbox"
                  checked={hideGlobal}
                  onChange={(e) => setHideGlobal(e.target.checked)}
                  aria-labelledby="modal-hide-global-label"
                />
                <span className="toggle-slider" />
              </label>
            </div>
          </div>
        </section>

        <div className="settings-section-divider" aria-hidden="true" />

        {/* ========================================================
            SECTION 3: Cache & Maintenance
           ======================================================== */}
        <section className="settings-modal-section" aria-labelledby="section-cache-title">
          <div className="settings-section-header">
            <div className="settings-section-title-wrap">
              <Database size={16} aria-hidden="true" />
              <h4 id="section-cache-title" className="settings-section-title">缓存清理</h4>
            </div>
          </div>

          {/* Explanation when disabled in demo or disconnected */}
          {!isRealConnected && (
            <div className="mixed-content-alert" role="status">
              <AlertTriangle size={15} color="var(--status-amber)" aria-hidden="true" />
              <span>
                {demoMode
                  ? '演示模式下无法清理真实核心缓存。'
                  : '控制器未连接，请先完成连接后再清理缓存。'}
              </span>
            </div>
          )}

          <div className="cache-maintenance-container">
            {/* Fake-IP Cache Row */}
            <div className="cache-maintenance-item">
              <div className="cache-maintenance-row">
                <div className="setting-desc">
                  <span className="setting-name">Fake-IP 映射缓存</span>
                </div>
                <button
                  type="button"
                  className="btn-circle-action size-md danger cache-flush-btn"
                  onClick={() => setConfirmFlush('fakeip')}
                  disabled={!isRealConnected || isFlushingFakeip || isFlushingDns}
                  data-tooltip={isFlushingFakeip ? '正在清空 Fake-IP 映射缓存…' : '清空 Fake-IP 映射缓存'}
                  aria-label={isFlushingFakeip ? '正在清空 Fake-IP 映射缓存' : '清空 Fake-IP 映射缓存'}
                >
                  <Trash2 size={15} className={isFlushingFakeip ? 'spin-animation' : ''} aria-hidden="true" />
                </button>
              </div>

              {/* Inline confirmation for Fake-IP (no nested modal) */}
              {confirmFlush === 'fakeip' && (
                <div className="inline-confirm-box" role="alert">
                  <div className="inline-confirm-content">
                    <AlertTriangle size={15} color="var(--status-amber)" aria-hidden="true" />
                    <span className="inline-confirm-text">
                      确定清空 Fake-IP 映射缓存？清空后映射表将重置，活动连接可能需重新解析域名。
                    </span>
                  </div>
                  <div className="inline-confirm-actions">
                    <button
                      type="button"
                      className="pill-btn size-sm"
                      onClick={() => setConfirmFlush(null)}
                      disabled={isFlushingFakeip}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      className="pill-btn size-sm danger"
                      onClick={handleFlushFakeip}
                      disabled={isFlushingFakeip}
                    >
                      {isFlushingFakeip ? '清空中…' : '确认清空'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="cache-row-divider" aria-hidden="true" />

            {/* DNS Cache Row */}
            <div className="cache-maintenance-item">
              <div className="cache-maintenance-row">
                <div className="setting-desc">
                  <span className="setting-name">DNS 解析缓存</span>
                </div>
                <button
                  type="button"
                  className="btn-circle-action size-md danger cache-flush-btn"
                  onClick={() => setConfirmFlush('dns')}
                  disabled={!isRealConnected || isFlushingFakeip || isFlushingDns}
                  data-tooltip={isFlushingDns ? '正在清空 DNS 解析缓存…' : '清空 DNS 解析缓存'}
                  aria-label={isFlushingDns ? '正在清空 DNS 解析缓存' : '清空 DNS 解析缓存'}
                >
                  <Trash2 size={15} className={isFlushingDns ? 'spin-animation' : ''} aria-hidden="true" />
                </button>
              </div>

              {/* Inline confirmation for DNS (no nested modal) */}
              {confirmFlush === 'dns' && (
                <div className="inline-confirm-box" role="alert">
                  <div className="inline-confirm-content">
                    <AlertTriangle size={15} color="var(--status-amber)" aria-hidden="true" />
                    <span className="inline-confirm-text">
                      确定清空 DNS 解析缓存？清空后核心将重新向上游查询最新解析记录（需内核 &gt;= v1.19.12）。
                    </span>
                  </div>
                  <div className="inline-confirm-actions">
                    <button
                      type="button"
                      className="pill-btn size-sm"
                      onClick={() => setConfirmFlush(null)}
                      disabled={isFlushingDns}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      className="pill-btn size-sm danger"
                      onClick={handleFlushDns}
                      disabled={isFlushingDns}
                    >
                      {isFlushingDns ? '清空中…' : '确认清空'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </Modal>
  );
};
