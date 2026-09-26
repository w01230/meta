import React, { useState } from 'react';
import { useController } from '../../context/ControllerContext';
import { Search, ShieldCheck, X } from 'lucide-react';

export const RulesView: React.FC = () => {
  const { rules, status } = useController();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');

  const isConnected = status === 'connected';

  // Extract distinct rule types
  const ruleTypes = Array.from(new Set(rules.map((r) => r.type)));

  // Filter rules
  const filtered = rules.filter((rule) => {
    if (typeFilter !== 'ALL' && rule.type !== typeFilter) {
      return false;
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchPayload = (rule.payload || '').toLowerCase().includes(q);
      const matchProxy = (rule.proxy || '').toLowerCase().includes(q);
      const matchType = (rule.type || '').toLowerCase().includes(q);
      return matchPayload || matchProxy || matchType;
    }
    return true;
  });

  return (
    <div className="rules-view-container">
      {/* Top Toolbar */}
      <div className="rules-toolbar meta-card">
        <div className="toolbar-left">
          <div className="rules-stat-badge">
            <span className="stat-label">生效规则</span>
            <span className="stat-val tabular-nums">{rules.length} 条</span>
          </div>

          {/* Type Filter Pills */}
          <div className="rules-type-pills">
            <button
              className={`rule-type-pill ${typeFilter === 'ALL' ? 'active' : ''}`}
              onClick={() => setTypeFilter('ALL')}
            >
              全部类型
            </button>
            {ruleTypes.slice(0, 6).map((t) => (
              <button
                key={t}
                className={`rule-type-pill ${typeFilter === t ? 'active' : ''}`}
                onClick={() => setTypeFilter(t)}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="toolbar-right">
          <div className="search-pill-box">
            <Search size={14} className="search-icon" />
            <input
              type="text"
              className="search-mini-input"
              placeholder="搜索规则载荷或策略组..."
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

      {/* Rules Table */}
      <div className="meta-card rules-table-card">
        {filtered.length === 0 ? (
          <div className="empty-card-box">
            <ShieldCheck size={32} color="var(--text-muted)" />
            <h4>{isConnected ? '没有符合条件的规则' : '未连接核心'}</h4>
            <p>{isConnected ? '请检查搜索关键字或筛选条件' : '连接外部控制器以获取路由分流规则'}</p>
          </div>
        ) : (
          <div
            className="rules-table-wrapper"
            role="region"
            aria-label="规则列表，可横向滚动查看全部列"
            tabIndex={0}
          >
            <table className="rules-table">
              <thead>
                <tr>
                  <th style={{ width: '8%' }}>序号</th>
                  <th style={{ width: '22%' }}>规则类型</th>
                  <th style={{ width: '45%' }}>匹配载荷</th>
                  <th style={{ width: '25%' }}>目标代理策略</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((rule, idx) => (
                  <tr key={`${rule.type}-${rule.payload}-${idx}`} className="rule-table-row">
                    <td className="tabular-nums rule-idx-cell">#{idx + 1}</td>
                    <td>
                      <span className="rule-type-tag">{rule.type}</span>
                    </td>
                    <td>
                      <span className="rule-payload-text" data-tooltip={rule.payload}>
                        {rule.payload || '— (默认全局匹配)'}
                      </span>
                    </td>
                    <td>
                      <span className="rule-proxy-badge">{rule.proxy}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
