/**
 * 最小 ReAct Agent：用本地“规则模型”模拟模型决策。
 * 运行：node demos/agent-basics/01-react-loop.mjs
 */

const tools = {
  get_weather: async ({ city }) => ({ city, temperature: 26, condition: '晴' }),
  create_note: async ({ title, content }) => ({ id: `note_${Date.now()}`, title, content }),
};

function fakeModel(messages) {
  const last = messages.at(-1);
  if (last.role === 'user') {
    return { type: 'tool_call', tool: 'get_weather', input: { city: '上海' } };
  }
  if (last.role === 'tool' && last.name === 'get_weather') {
    return {
      type: 'tool_call',
      tool: 'create_note',
      input: { title: '天气提醒', content: `${last.result.city}今天${last.result.temperature}℃，${last.result.condition}` },
    };
  }
  return { type: 'final', content: `已完成：${last.result.title}` };
}

async function runAgent(userInput) {
  const messages = [{ role: 'user', content: userInput }];
  for (let iteration = 1; iteration <= 5; iteration += 1) {
    const action = fakeModel(messages);
    console.log(`\n[第 ${iteration} 轮] 模型决策：`, action);
    if (action.type === 'final') return action.content;

    if (!Object.hasOwn(tools, action.tool)) throw new Error(`工具未注册：${action.tool}`);
    const result = await tools[action.tool](action.input);
    const observation = { role: 'tool', name: action.tool, result };
    messages.push(observation);
    console.log('[Observation] 工具结果：', result);
  }
  throw new Error('超过最大循环次数');
}

console.log(await runAgent('帮我查询上海天气并记录提醒'));
