import React, { useState } from 'react';
import { useController } from '../../context/ControllerContext';
import { useToast } from '../common/Toast';
import { checkMixedContentRisk } from '../../utils/url';
import { resolveStatusText } from '../../utils/status';
import { RunMode, LogLevel } from '../../types/api';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { ApiError } from '../../services/apiClient';
import { 
  Server, 
  Key, 
  AlertTriangle, 
  CheckCircle2, 
  Sliders, 
  Eye, 
  EyeOff,
  Sparkles,
  Database,
  Trash2
} from 'lucide-react';

export const ConfigView: React.FC = () => {
  const {
    baseUrl,
    setBaseUrl,
    secret,
    setSecret,
    hideGlobal,
    setHideGlobal,
    demoMode,
    setDemoMode,
    status,
    statusError,
    version,
    config,
    updateConfigMode,
    updateConfigField,
    connectController,
    apiClient
  } = useController();

  const { showToast } = useToast();
  const [inputUrl, setInputUrl] = useState(baseUrl);
  const [inputSecret, setInputSecret] = useState(secret);
  const [showSecret, setShowSecret] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isTogglingDemo, setIsTogglingDemo] = useState(false);
  const [confirmFlush, setConfirmFlush] = useState<'fakeip' | 'dns' | null>(null);
  const [isFlushingFakeip, setIsFlushingFakeip] = useState(false);
  const [isFlushingDns, setIsFlushingDns] = useState(false);

  const mixedContentRisk = checkMixedContentRisk(inputUrl);
  const isRealConnected = !demoMode && status === 'connected';

  const [localError, setLocalError] = useState<string | null>(null);

  const handleToggleDemo = async () => {
    if (isTogglingDemo || isTesting) return;
    const next = !demoMode;
    setIsTogglingDemo(true);
    setLocalError(null);
    try {
      const success = await setDemoMode(next);
      if (next) {
        showToast('已开启演示预览模式', 'info');
      } else if (success) {
        showToast('已退出演示模式，正在建立实时连接', 'success');
      } else {
        const errorMsg = '退出演示模式失败：无法连接到外部控制器，保持演示模式';
        setLocalError(errorMsg);
        showToast(errorMsg, 'error');
      }
    } catch {
      const errorMsg = '退出演示模式失败：无法连接到外部控制器，保持演示模式';
      setLocalError(errorMsg);
      showToast(errorMsg, 'error');
    } finally {
      setIsTogglingDemo(false);
    }
  };

  const handleTestAndConnect = async () => {
    if (isTesting || isTogglingDemo) return;
    setIsTesting(true);
    setLocalError(null);

    const wasDemo = demoMode;
    const success = await connectController(inputUrl, inputSecret);
    setIsTesting(false);

    if (success) {
      showToast(
        wasDemo
          ? '已退出演示模式，正在建立实时连接'
          : '控制器验证成功，正在建立实时连接',
        'success'
      );
    } else {
      if (wasDemo) {
        const msg = '退出演示模式失败：无法连接到外部控制器，请检查配置，保持演示模式';
        setLocalError(msg);
        showToast(msg, 'error');
      } else {
        setLocalError(null);
        showToast('连接失败，请检查控制器地址、端口与密钥配置', 'error');
      }
    }
  };

  const handleModeChange = async (mode: RunMode) => {
    try {
      await updateConfigMode(mode);
      showToast(`已切换至 ${mode === 'rule' ? '规则' : mode === 'global' ? '全局' : '直连'} 模式`, 'success');
    } catch (err: unknown) {
      showToast(`更新模式失败: ${(err as Error)?.message}`, 'error');
    }
  };

  const handleLogLevelChange = async (level: LogLevel) => {
    try {
      await updateConfigField({ 'log-level': level });
      showToast(`日志级别已更新为: ${level}`, 'success');
    } catch (err: unknown) {
      showToast(`更新日志级别失败: ${(err as Error)?.message}`, 'error');
    }
  };

  const handleAllowLanToggle = async (checked: boolean) => {
    try {
      await updateConfigField({ 'allow-lan': checked });
      showToast(`允许局域网连接已${checked ? '开启' : '关闭'}`, 'success');
    } catch (err: unknown) {
      showToast(`更新失败: ${(err as Error)?.message}`, 'error');
    }
  };

  const handleFlushFakeip = async () => {
    setConfirmFlush(null);
    setIsFlushingFakeip(true);
    try {
      await apiClient.flushFakeipCache();
      showToast('Fake-IP 缓存已成功清空', 'success');
    } catch (err: unknown) {
      const msg = (err as Error)?.message || '清理 Fake-IP 缓存失败';
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
      showToast('DNS 缓存已成功清空', 'success');
    } catch (err: unknown) {
      const apiErr = err as ApiError;
      if (apiErr?.status === 404) {
        showToast(apiErr.message || '当前内核版本不支持清理 DNS 缓存 (POST /cache/dns/flush 需 >= v1.19.12)', 'error');
      } else {
        showToast(apiErr?.message || '清理 DNS 缓存失败', 'error');
      }
    } finally {
      setIsFlushingDns(false);
    }
  };

  return (
    <div className="config-view-container">
      {/* 1. Controller Connection Settings Card */}
      <div className="meta-card config-section-card">
        <div className="section-header">
          <div className="section-title-wrap">
            <Server size={18} />
            <h3 className="section-title">外部控制器连接 (External Controller)</h3>
          </div>
          <div className={`pill-badge status-${status} ${demoMode ? 'demo-mode-badge' : ''}`}>
            <span className="status-dot" />
            <span>{resolveStatusText(status, demoMode, !!version?.version)}</span>
          </div>
        </div>

        {/* Form */}
        <div className="config-form-grid">
          <div className="form-item">
            <label className="form-label" htmlFor="ctrl-url">控制器地址 (API Base URL)</label>
            <div className="input-with-icon">
              <Server size={15} className="input-icon" />
              <input
                id="ctrl-url"
                type="text"
                className="meta-input form-input"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                placeholder="http://127.0.0.1:9090"
              />
            </div>
            <span className="form-hint">本地默认一般为 http://127.0.0.1:9090</span>
          </div>

          <div className="form-item">
            <label className="form-label" htmlFor="ctrl-secret">访问密钥 (Secret / Token)</label>
            <div className="input-with-icon">
              <Key size={15} className="input-icon" />
              <input
                id="ctrl-secret"
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
            <span className="form-hint security-note">
              🔒 安全保障：密钥仅在当前会话内存及 sessionStorage 中暂存，绝不会存入持久化 localStorage。
            </span>
          </div>
        </div>

        {/* Buttons */}
        <div className="config-action-row">
          <button
            className="pill-btn primary"
            onClick={handleTestAndConnect}
            disabled={isTesting || isTogglingDemo}
          >
            <CheckCircle2 size={15} />
            <span>{isTesting ? '正在测试并连接...' : '测试并保存连接'}</span>
          </button>

          <button
            className={`pill-btn ${demoMode ? 'danger' : ''}`}
            onClick={handleToggleDemo}
            disabled={isTogglingDemo || isTesting}
          >
            <Sparkles size={15} className={isTogglingDemo ? 'spin-animation' : ''} />
            <span>
              {isTogglingDemo
                ? '正在切换...'
                : demoMode
                ? '退出演示模式 (切回真实核心)'
                : '开启演示预览模式'}
            </span>
          </button>
        </div>

        {/* Mixed Content Warning */}
        {mixedContentRisk.hasRisk && (
          <div className="mixed-content-alert">
            <AlertTriangle size={18} color="var(--status-amber)" />
            <p>{mixedContentRisk.message}</p>
          </div>
        )}

        {/* Error Detail */}
        {(localError || (status === 'error' && !demoMode)) && (
          <div className="error-feedback-alert">
            <AlertTriangle size={18} color="var(--status-red)" />
            <div className="error-text">
              <strong>连接失败：</strong>
              <span>{localError || (status === 'error' && !demoMode ? statusError : null) || '连接失败，请检查地址、端口与密钥配置'}</span>
            </div>
          </div>
        )}
      </div>

      {/* 2. Runtime Configuration Card */}
      <div className="meta-card config-section-card">
        <div className="section-header">
          <div className="section-title-wrap">
            <Sliders size={18} />
            <h3 className="section-title">运行时参数 (Runtime Config)</h3>
          </div>
          {version?.version && (
            <span className="version-tag tabular-nums">{version.version}</span>
          )}
        </div>

        <div className="runtime-settings-list">
          {/* Mode */}
          <div className="runtime-setting-row">
            <div className="setting-desc">
              <span className="setting-name">分流运行模式 (mode)</span>
              <span className="setting-subtext">选择流量由规则分流、强制全局代理还是全部直连</span>
            </div>
            <div className="mode-segmented-capsule">
              {(['rule', 'global', 'direct'] as RunMode[]).map((m) => (
                <button
                  key={m}
                  className={`mode-capsule-item ${config?.mode === m ? 'active' : ''}`}
                  onClick={() => handleModeChange(m)}
                  disabled={status !== 'connected'}
                >
                  {m === 'rule' ? '规则模式' : m === 'global' ? '全局模式' : '直连模式'}
                </button>
              ))}
            </div>
          </div>

          {/* Log Level */}
          <div className="runtime-setting-row">
            <div className="setting-desc">
              <span className="setting-name">核心日志等级 (log-level)</span>
              <span className="setting-subtext">调整后台日志输出的过滤级别</span>
            </div>
            <div className="mode-segmented-capsule">
              {(['info', 'warning', 'error', 'debug', 'silent'] as LogLevel[]).map((lvl) => (
                <button
                  key={lvl}
                  className={`mode-capsule-item ${config?.['log-level'] === lvl ? 'active' : ''}`}
                  onClick={() => handleLogLevelChange(lvl)}
                  disabled={status !== 'connected'}
                >
                  {lvl.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Allow LAN */}
          <div className="runtime-setting-row">
            <div className="setting-desc">
              <label
                htmlFor="config-allow-lan"
                id="config-allow-lan-label"
                className="setting-name"
              >
                允许局域网连接 (allow-lan)
              </label>
              <span className="setting-subtext">允许同一局域网下的其他设备连接代理端口</span>
            </div>
            <label className="toggle-switch" htmlFor="config-allow-lan">
              <input
                id="config-allow-lan"
                type="checkbox"
                checked={config?.['allow-lan'] ?? false}
                onChange={(e) => handleAllowLanToggle(e.target.checked)}
                disabled={status !== 'connected'}
                aria-labelledby="config-allow-lan-label"
              />
              <span className="toggle-slider" />
            </label>
          </div>

          {/* Hide GLOBAL Group */}
          <div className="runtime-setting-row">
            <div className="setting-desc">
              <label
                htmlFor="config-hide-global"
                id="config-hide-global-label"
                className="setting-name"
              >
                隐藏 GLOBAL 分组
              </label>
              <span className="setting-subtext">在代理组列表中隐藏全局根策略组 (GLOBAL)</span>
            </div>
            <label className="toggle-switch" htmlFor="config-hide-global">
              <input
                id="config-hide-global"
                type="checkbox"
                checked={hideGlobal}
                onChange={(e) => setHideGlobal(e.target.checked)}
                aria-labelledby="config-hide-global-label"
              />
              <span className="toggle-slider" />
            </label>
          </div>
        </div>
      </div>

      {/* 3. Cache & Maintenance Card */}
      <div className="meta-card config-section-card">
        <div className="section-header">
          <div className="section-title-wrap">
            <Database size={18} />
            <h3 className="section-title">缓存与维护 (Cache & Maintenance)</h3>
          </div>
        </div>

        <p className="setting-subtext">
          清空核心内部维护的 Fake-IP 映射池或 DNS 解析缓存。此操作具有即时影响，清空后客户端将重新向上游发起真实域名解析。
        </p>

        {/* Explanation when disabled in demo or disconnected */}
        {!isRealConnected && (
          <div className="mixed-content-alert" role="status">
            <AlertTriangle size={16} color="var(--status-amber)" />
            <span>
              {demoMode
                ? '当前处于仿真演示预览模式，已禁用对真实核心的缓存清理操作。'
                : '控制器未连接，无法执行缓存清理操作。请先配置并连接外部控制器。'}
            </span>
          </div>
        )}

        <div className="cache-maintenance-container">
          <div className="cache-maintenance-row">
            <div className="setting-desc">
              <span className="setting-name">Fake-IP 映射缓存</span>
              <span className="setting-subtext">清空当前内核中记录的所有 Fake-IP 映射关系 (POST /cache/fakeip/flush)</span>
            </div>
            <button
              type="button"
              className="btn-circle-action size-md danger cache-flush-btn"
              onClick={() => setConfirmFlush('fakeip')}
              disabled={!isRealConnected || isFlushingFakeip || isFlushingDns}
              title={isFlushingFakeip ? '正在清空 Fake-IP 映射缓存...' : '清空 Fake-IP 映射缓存'}
              aria-label={isFlushingFakeip ? '正在清空 Fake-IP 映射缓存' : '清空 Fake-IP 映射缓存'}
            >
              <Trash2 size={15} className={isFlushingFakeip ? 'spin-animation' : ''} aria-hidden="true" />
            </button>
          </div>

          <div className="cache-row-divider" aria-hidden="true" />

          <div className="cache-maintenance-row">
            <div className="setting-desc">
              <span className="setting-name">DNS 解析缓存</span>
              <span className="setting-subtext">清除内核上游 DNS 响应记录缓存 (POST /cache/dns/flush，需内核 &gt;= v1.19.12)</span>
            </div>
            <button
              type="button"
              className="btn-circle-action size-md danger cache-flush-btn"
              onClick={() => setConfirmFlush('dns')}
              disabled={!isRealConnected || isFlushingFakeip || isFlushingDns}
              title={isFlushingDns ? '正在清空 DNS 解析缓存...' : '清除 DNS 解析缓存'}
              aria-label={isFlushingDns ? '正在清空 DNS 解析缓存' : '清除 DNS 解析缓存'}
            >
              <Trash2 size={15} className={isFlushingDns ? 'spin-animation' : ''} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {/* Confirmation Dialogs */}
      <ConfirmDialog
        isOpen={confirmFlush === 'fakeip'}
        title="确认清空 Fake-IP 缓存"
        message="确定要清空核心的 Fake-IP 映射缓存吗？清空后当前映射表将被重置，活动连接可能需要重新建立域名解析。"
        confirmText="确认清空"
        cancelText="取消"
        isDestructive={true}
        onConfirm={handleFlushFakeip}
        onClose={() => setConfirmFlush(null)}
      />

      <ConfirmDialog
        isOpen={confirmFlush === 'dns'}
        title="确认清空 DNS 缓存"
        message="确定要清空核心的 DNS 解析缓存吗？清空后核心将重新向上游 DNS 查询最新解析记录（需内核版本 >= v1.19.12）。"
        confirmText="确认清空"
        cancelText="取消"
        isDestructive={true}
        onConfirm={handleFlushDns}
        onClose={() => setConfirmFlush(null)}
      />
    </div>
  );
};
