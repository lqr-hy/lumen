/**
 * Checkpoint 恢复 Demo：第二步失败后，重启并从失败步骤继续。
 * 运行：node demos/agent-basics/02-checkpoint-recovery.mjs
 */

const steps = [
  { id: 'reference.prepare', title: '准备参考图' },
  { id: 'design.generate', title: '生成设计稿' },
  { id: 'canvas.present', title: '写入画布并 ACK' },
];

const checkpoints = new Map();
let firstRun = true;

async function execute(step) {
  console.log(`执行：${step.title}`);
  if (step.id === 'design.generate' && firstRun) {
    firstRun = false;
    throw new Error('图片 Provider 临时超时');
  }
  return { stepId: step.id, status: 'success', at: new Date().toISOString() };
}

async function runFromCheckpoint() {
  for (const step of steps) {
    if (checkpoints.has(step.id)) {
      console.log(`跳过已完成步骤：${step.id}`);
      continue;
    }
    try {
      const result = await execute(step);
      checkpoints.set(step.id, result);
      console.log(`保存 Checkpoint：${step.id}`);
    } catch (error) {
      console.log(`步骤失败：${step.id}，原因：${error.message}`);
      return false;
    }
  }
  return true;
}

console.log('--- 第一次运行 ---');
await runFromCheckpoint();
console.log('\n--- 用户点击继续，恢复运行 ---');
const completed = await runFromCheckpoint();
console.log('\n最终状态：', completed ? 'completed' : 'failed');
console.log('已有检查点：', [...checkpoints.keys()]);
