import { ConnectionStatus } from '../types/connection';
import { MemoryTick } from '../types/api';
import { formatBytes } from './format';

/**
 * Calculates joint connection status from mandatory WebSocket streams (traffic and connections).
 * Both must be healthy for the status to be 'connected'.
 */
export function calculateJointWsStatus(
  trafficConnected: boolean,
  connectionsConnected: boolean
): ConnectionStatus {
  if (trafficConnected && connectionsConnected) {
    return 'connected';
  }
  return 'connecting';
}

/**
 * Resolves precise, verified status copy for navbar, sidebar, and settings dialogs.
 * Avoids falsely claiming 'core running' unless genuine controller communication is verified.
 */
export function resolveStatusText(
  status: ConnectionStatus,
  demoMode: boolean,
  hasVerifiedVersion: boolean
): string {
  if (demoMode) {
    return '演示仿真数据';
  }
  if (status === 'connected') {
    return hasVerifiedVersion ? '核心已连接' : '控制器已连接';
  }
  if (status === 'connecting') {
    return '正在连接控制器...';
  }
  return '控制器未连接';
}

/**
 * Resolves memory card subtitle without falsely reporting "系统正常" or indefinitely
 * showing "等待内存采样..." when telemetry is present but oslimit is unprovided or zero.
 */
export function resolveMemorySubtitle(
  isConnected: boolean,
  memory: MemoryTick | null
): string {
  if (!isConnected) {
    return '数据暂不可用';
  }
  if (!memory) {
    return '等待内存采样...';
  }
  if (memory.oslimit > 0) {
    return `物理上限: ${formatBytes(memory.oslimit)}`;
  }
  return '未提供内存上限';
}
