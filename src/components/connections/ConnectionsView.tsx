import React, { useState } from 'react';
import { useController } from '../../context/ControllerContext';
import { formatBytes, formatDuration } from '../../utils/format';
import { 
  Search, 
  Trash2, 
  X, 
  ArrowUpDown, 
  Activity
} from 'lucide-react';
import { useToast } from '../common/Toast';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { Modal } from '../common/Modal';
import { ConnectionItem } from '../../types/api';

export const ConnectionsView: React.FC = () => {
  const {
    connections,
    trafficTotal,
    closeConnection,
    closeAllConnections,
    status
  } = useController();

  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [networkFilter, setNetworkFilter] = useState<'all' | 'tcp' | 'udp'>('all');
  const [sortBy, setSortBy] = useState<'download' | 'upload' | 'time' | 'host'>('download');
  const [showCloseAllConfirm, setShowCloseAllConfirm] = useState(false);
  const [selectedConn, setSelectedConn] = useState<ConnectionItem | null>(null);

  const isConnected = status === 'connected';

  // Filtering
  const filtered = connections.filter((conn) => {
    // Network filter
    if (networkFilter !== 'all' && conn.metadata.network.toLowerCase() !== networkFilter) {
      return false;
    }
    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      const host = (conn.metadata.host || '').toLowerCase();
      const dstIp = (conn.metadata.destinationIP || '').toLowerCase();
      const proc = (conn.metadata.process || '').toLowerCase();
      const rule = (conn.rule || '').toLowerCase();
      const rulePayload = (conn.rulePayload || '').toLowerCase();
      const chain = (conn.chains || []).join(' ').toLowerCase();

      return (
        host.includes(q) ||
        dstIp.includes(q) ||
        proc.includes(q) ||
        rule.includes(q) ||
        rulePayload.includes(q) ||
        chain.includes(q)
      );
    }
    return true;
  });

  // Sorting
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'download') return b.download - a.download;
    if (sortBy === 'upload') return b.upload - a.upload;
    if (sortBy === 'time') return new Date(b.start).getTime() - new Date(a.start).getTime();
    if (sortBy === 'host') {
      const hostA = a.metadata.host || a.metadata.destinationIP || '';
      const hostB = b.metadata.host || b.metadata.destinationIP || '';
      return hostA.localeCompare(hostB);
    }
    return 0;
  });

  const handleCloseOne = async (e: React.MouseEvent, id: string, host: string) => {
    e.stopPropagation();
    try {
      await closeConnection(id);
      showToast(`已断开连接: ${host}`, 'info');
    } catch {
      showToast('断开连接失败', 'error');
    }
  };

  const handleConfirmCloseAll = async () => {
    try {
      await closeAllConnections();
      showToast('已断开所有活动连接', 'success');
    } catch {
      showToast('关闭连接失败', 'error');
    }
  };

  return (
    <div className="connections-view-container">
      {/* Top Stats & Action Bar */}
      <div className="connections-top-bar meta-card">
        <div className="conn-stats-group">
          <div className="conn-stat-item">
            <span className="stat-label">活动连接</span>
            <span className="stat-val tabular-nums">{connections.length}</span>
          </div>
          <div className="conn-stat-item">
            <span className="stat-label">累计下行</span>
            <span className="stat-val tabular-nums">{formatBytes(trafficTotal.downTotal)}</span>
          </div>
          <div className="conn-stat-item">
            <span className="stat-label">累计上行</span>
            <span className="stat-val tabular-nums">{formatBytes(trafficTotal.upTotal)}</span>
          </div>
        </div>

        <div className="conn-actions-group">
          <button
            type="button"
            className="btn-circle-action size-md danger"
            onClick={() => setShowCloseAllConfirm(true)}
            disabled={!isConnected || connections.length === 0}
            data-tooltip="断开全部活动连接"
            aria-label="断开全部活动连接"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="connections-filter-bar meta-card">
        <div className="filter-left">
          {/* Network Filter Pills */}
          <div className="mode-segmented-capsule" role="group" aria-label="网络协议筛选">
            {(['all', 'tcp', 'udp'] as const).map((net) => {
              const label = net === 'all' ? '全部网络' : net.toUpperCase();
              return (
                <button
                  key={net}
                  className={`mode-capsule-item ${networkFilter === net ? 'active' : ''}`}
                  onClick={() => setNetworkFilter(net)}
                  aria-pressed={networkFilter === net}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Sort Selector */}
          <button
            className="pill-btn sort-toggle-btn"
            onClick={() => {
              const order: Array<'download' | 'upload' | 'time' | 'host'> = [
                'download',
                'upload',
                'time',
                'host'
              ];
              const nextIdx = (order.indexOf(sortBy) + 1) % order.length;
              setSortBy(order[nextIdx]);
            }}
            data-tooltip="切换排序"
          >
            <ArrowUpDown size={14} />
            <span>
              {sortBy === 'download'
                ? '下载优先'
                : sortBy === 'upload'
                ? '上传优先'
                : sortBy === 'time'
                ? '最新连接'
                : '按主机名'}
            </span>
          </button>
        </div>

        <div className="filter-right">
          <div className="search-pill-box">
            <Search size={14} className="search-icon" />
            <input
              type="text"
              className="search-mini-input"
              placeholder="搜索主机、IP、进程、规则..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button className="clear-btn" onClick={() => setSearch('')}>
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Connections Table */}
      <div className="meta-card connections-table-card">
        {sorted.length === 0 ? (
          <div className="empty-card-box">
            <Activity size={32} color="var(--text-muted)" />
            <h4>{isConnected ? '没有符合条件的连接' : '未连接核心'}</h4>
            <p>{isConnected ? '当前没有活动网络请求或搜索无结果' : '请检查外部控制器状态'}</p>
          </div>
        ) : (
          <div
            className="connections-table-wrapper"
            role="region"
            aria-label="连接列表，可横向滚动查看全部列"
            tabIndex={0}
          >
            <table className="connections-table">
              <thead>
                <tr>
                  <th style={{ width: '28%' }}>目标地址 / 进程</th>
                  <th style={{ width: '10%' }}>网络协议</th>
                  <th style={{ width: '20%' }}>分流匹配</th>
                  <th style={{ width: '18%' }}>代理链路</th>
                  <th style={{ width: '12%' }} className="text-right">已传输流量</th>
                  <th style={{ width: '7%' }} className="text-right">耗时</th>
                  <th style={{ width: '5%' }} className="text-center">操作</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((conn) => {
                  const host = conn.metadata.host || conn.metadata.destinationIP;
                  const port = conn.metadata.destinationPort;
                  const process = conn.metadata.process || '未知进程';
                  const chainText = (conn.chains || []).join(' → ') || 'DIRECT';

                  return (
                    <tr
                      key={conn.id}
                      onClick={() => setSelectedConn(conn)}
                      className="conn-table-row"
                    >
                      <td>
                        <div className="cell-host-block">
                          <span className="conn-target-host" data-tooltip={`${host}:${port}`}>
                            {host}
                            {port && <span className="conn-target-port">:{port}</span>}
                          </span>
                          <span className="conn-process-badge">{process}</span>
                        </div>
                      </td>
                      <td>
                        <span className="conn-proto-tag">
                          {conn.metadata.network.toUpperCase()}
                        </span>
                      </td>
                      <td>
                        <div className="cell-rule-block">
                          <span className="conn-rule-name">{conn.rule}</span>
                          {conn.rulePayload && (
                            <span className="conn-rule-payload" data-tooltip={conn.rulePayload}>
                              {conn.rulePayload}
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className="conn-chain-badge" title={chainText}>
                          {chainText}
                        </span>
                      </td>
                      <td className="text-right tabular-nums">
                        <div className="cell-traffic-block">
                          <span className="traffic-down">↓ {formatBytes(conn.download)}</span>
                          <span className="traffic-up">↑ {formatBytes(conn.upload)}</span>
                        </div>
                      </td>
                      <td className="text-right tabular-nums">
                        <span className="conn-duration">{formatDuration(conn.start)}</span>
                      </td>
                      <td className="text-center">
                        <button
                          type="button"
                          className="btn-circle-action size-xs danger table-close-btn"
                          onClick={(e) => handleCloseOne(e, conn.id, host)}
                          data-tooltip="断开此连接"
                          aria-label={`断开连接 ${host}`}
                        >
                          <X size={12} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirmation Dialog for Batch Close */}
      <ConfirmDialog
        isOpen={showCloseAllConfirm}
        onClose={() => setShowCloseAllConfirm(false)}
        onConfirm={handleConfirmCloseAll}
        title="确认断开全部连接？"
        message={`此操作将强制终止当前所有的 ${connections.length} 条网络连接。可能会导致正在进行的网页请求或下载中断。`}
        confirmText="确认断开全部"
        cancelText="取消"
        isDestructive={true}
      />

      {/* Connection Detail Modal */}
      {selectedConn && (
        <Modal
          isOpen={!!selectedConn}
          onClose={() => setSelectedConn(null)}
          title="连接详细信息"
          subtitle={`ID: ${selectedConn.id}`}
          maxWidth="640px"
        >
          <div className="conn-detail-grid">
            <div className="detail-item">
              <span className="detail-key">目标域名 / 主机</span>
              <span className="detail-val">{selectedConn.metadata.host || '—'}</span>
            </div>
            <div className="detail-item">
              <span className="detail-key">目标 IP : 端口</span>
              <span className="detail-val">
                {selectedConn.metadata.destinationIP}:{selectedConn.metadata.destinationPort}
              </span>
            </div>
            <div className="detail-item">
              <span className="detail-key">本地源 IP : 端口</span>
              <span className="detail-val">
                {selectedConn.metadata.sourceIP}:{selectedConn.metadata.sourcePort}
              </span>
            </div>
            <div className="detail-item">
              <span className="detail-key">发起进程</span>
              <span className="detail-val">
                {selectedConn.metadata.process || '未知进程'}
                {selectedConn.metadata.processPath && (
                  <span className="detail-subval">{selectedConn.metadata.processPath}</span>
                )}
              </span>
            </div>
            <div className="detail-item">
              <span className="detail-key">入站协议与端口</span>
              <span className="detail-val">
                {selectedConn.metadata.type} ({selectedConn.metadata.inboundPort || '—'})
              </span>
            </div>
            <div className="detail-item">
              <span className="detail-key">分流匹配规则</span>
              <span className="detail-val">
                {selectedConn.rule}
                {selectedConn.rulePayload ? ` (${selectedConn.rulePayload})` : ''}
              </span>
            </div>
            <div className="detail-item full-width">
              <span className="detail-key">代理链路节点</span>
              <span className="detail-val chain-flow">
                {(selectedConn.chains || []).join('  ⟶  ')}
              </span>
            </div>
            <div className="detail-item">
              <span className="detail-key">下载传输</span>
              <span className="detail-val tabular-nums">
                {formatBytes(selectedConn.download)} ({selectedConn.download.toLocaleString()} B)
              </span>
            </div>
            <div className="detail-item">
              <span className="detail-key">上传传输</span>
              <span className="detail-val tabular-nums">
                {formatBytes(selectedConn.upload)} ({selectedConn.upload.toLocaleString()} B)
              </span>
            </div>
            <div className="detail-item">
              <span className="detail-key">建立时间</span>
              <span className="detail-val tabular-nums">
                {new Date(selectedConn.start).toLocaleString()}
              </span>
            </div>
            <div className="detail-item">
              <span className="detail-key">持续时长</span>
              <span className="detail-val tabular-nums">
                {formatDuration(selectedConn.start)}
              </span>
            </div>
          </div>
          <div className="modal-footer-action">
            <button
              className="pill-btn danger"
              onClick={() => {
                closeConnection(selectedConn.id);
                setSelectedConn(null);
                showToast('已断开连接', 'info');
              }}
            >
              断开此连接
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};
