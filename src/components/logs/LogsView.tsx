import React, { useState, useEffect, useRef } from 'react';
import { useController } from '../../context/ControllerContext';
import { LogLevel } from '../../types/api';
import { 
  Search, 
  Trash2, 
  Copy, 
  Pause, 
  Play, 
  X, 
  Terminal 
} from 'lucide-react';
import { useToast } from '../common/Toast';
import { ConfirmDialog } from '../common/ConfirmDialog';

export const LogsView: React.FC = () => {
  const {
    logs,
    clearLogs,
    isLogPaused,
    setIsLogPaused,
    unreadLogCount,
    logLevel,
    setLogLevel,
    status
  } = useController();

  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isChangingLogLevel, setIsChangingLogLevel] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const handleLogLevelChange = async (lvl: LogLevel) => {
    if (lvl === logLevel) return;
    if (status !== 'connected') {
      showToast('控制器未连接，无法修改日志级别', 'error');
      return;
    }
    setIsChangingLogLevel(true);
    try {
      await setLogLevel(lvl);
      showToast(`日志级别已更新为: ${lvl}`, 'success');
    } catch (err: unknown) {
      const msg = (err as Error)?.message || '未知错误';
      showToast(`更新日志级别失败: ${msg}`, 'error');
    } finally {
      setIsChangingLogLevel(false);
    }
  };

  // Auto-scroll when not paused
  useEffect(() => {
    if (!isLogPaused && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, isLogPaused]);

  // Filter logs by search
  const filteredLogs = logs.filter((l) => {
    if (!search.trim()) return true;
    return l.payload.toLowerCase().includes(search.toLowerCase());
  });

  const handleCopyAll = () => {
    if (filteredLogs.length === 0) return;
    const text = filteredLogs.map((l) => `[${l.time}] [${l.type.toUpperCase()}] ${l.payload}`).join('\n');
    navigator.clipboard.writeText(text);
    showToast(`已复制 ${filteredLogs.length} 条日志到剪贴板`, 'success');
  };

  const handleCopyLine = (line: string) => {
    navigator.clipboard.writeText(line);
    showToast('已复制日志行', 'info');
  };

  return (
    <div className="logs-view-container">
      {/* Logs Controls Bar */}
      <div className="logs-toolbar meta-card">
        <div className="toolbar-left">
          {/* Log Level Selector */}
          <div className="mode-segmented-capsule" role="group" aria-label="日志级别">
            {(['debug', 'info', 'warning', 'error', 'silent'] as LogLevel[]).map((lvl) => {
              return (
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
              );
            })}
          </div>

          {/* Pause / Follow Button */}
          <button
            type="button"
            className={`btn-circle-action size-md ${isLogPaused ? 'active danger' : ''}`}
            onClick={() => setIsLogPaused(!isLogPaused)}
            data-tooltip={isLogPaused ? `恢复自动滚动跟随${unreadLogCount > 0 ? ` (+${unreadLogCount}条新日志)` : ''}` : '暂停日志滚动跟随'}
            aria-label={isLogPaused ? `恢复自动滚动跟随${unreadLogCount > 0 ? ` (+${unreadLogCount}条新日志)` : ''}` : '暂停日志滚动跟随'}
          >
            {isLogPaused ? <Play size={15} /> : <Pause size={15} />}
            {isLogPaused && unreadLogCount > 0 && (
              <span className="unread-badge-dot tabular-nums" data-tooltip={`${unreadLogCount} 条新日志`}>
                {unreadLogCount > 99 ? '99+' : unreadLogCount}
              </span>
            )}
          </button>
        </div>

        <div className="toolbar-right">
          {/* Search Box */}
          <div className="search-pill-box">
            <Search size={14} className="search-icon" />
            <input
              type="text"
              className="search-mini-input"
              placeholder="搜索日志关键词..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button className="clear-btn" onClick={() => setSearch('')}>
                <X size={12} />
              </button>
            )}
          </div>

          {/* Copy Button */}
          <button
            type="button"
            className="btn-circle-action size-md"
            onClick={handleCopyAll}
            disabled={filteredLogs.length === 0}
            data-tooltip="复制过滤后的日志"
            aria-label="复制过滤后的日志"
          >
            <Copy size={15} />
          </button>

          {/* Clear Button */}
          <button
            type="button"
            className="btn-circle-action size-md danger"
            onClick={() => setShowClearConfirm(true)}
            disabled={logs.length === 0}
            data-tooltip="清空控制台日志"
            aria-label="清空控制台日志"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {/* Logs Console Window */}
      <div className="meta-card logs-console-card">
        <div className="logs-console-window" ref={logContainerRef}>
          {filteredLogs.length === 0 ? (
            <div className="empty-console-state">
              <Terminal size={32} color="var(--text-muted)" />
              <p>{status === 'connected' ? '等待新日志到达...' : '核心未连接，暂无日志流'}</p>
            </div>
          ) : (
            filteredLogs.map((item, idx) => (
              <div
                key={item.id || idx}
                className={`log-line-row level-${item.type}`}
                onClick={() => handleCopyLine(item.payload)}
                data-tooltip="点击复制此行"
              >
                <span className="log-col-time tabular-nums">{item.time}</span>
                <span className={`log-col-level level-${item.type}`}>
                  {item.type.toUpperCase()}
                </span>
                <span className="log-col-msg">{item.payload}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Clear Logs Confirm Dialog */}
      <ConfirmDialog
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={clearLogs}
        title="确认清空日志？"
        message="清空后将从当前视图移除所有已接收的日志条目，但不会影响后台核心日志记录。"
        confirmText="确认清空"
        cancelText="取消"
        isDestructive={true}
      />
    </div>
  );
};
