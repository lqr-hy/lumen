/**
 * Guardrail + Canvas ACK Demo。
 * 运行：node demos/agent-basics/03-guardrail-ack.mjs
 */

const allowedTools = new Set(['canvas.present']);

function validateToolCall(call) {
  if (!allowedTools.has(call.tool)) throw new Error(`拒绝调用未授权工具：${call.tool}`);
  if (!call.input?.targetId) throw new Error('缺少目标 targetId');
  if (call.input.elements?.length > 50) throw new Error('单次写入节点数超过上限');
}

async function canvasPresent(input) {
  // 模拟真实 Renderer 写入后的后置条件校验。
  const actual = { targetId: input.targetId, rootId: 'root_001', elementCount: input.elements.length };
  const ack = actual.targetId === input.targetId && actual.elementCount === input.elements.length;
  return { ack, actual };
}

async function execute(call) {
  validateToolCall(call);
  const result = await canvasPresent(call.input);
  if (!result.ack) throw new Error('Canvas ACK 后置条件失败，不能报告成功');
  return result;
}

const safeCall = { tool: 'canvas.present', input: { targetId: 'artboard_001', elements: [{ type: 'text' }] } };
console.log('安全调用结果：', await execute(safeCall));

try {
  await execute({ tool: 'delete_all_files', input: {} });
} catch (error) {
  console.log('安全拦截结果：', error.message);
}
