// Hidden narrative elapsed time. Return operations; the reader validates and
// commits them with the rest of the successful turn, never while streaming.
export function advanceClock(book, state, elapsedMinutes = 0) {
  if (!book.stateSchema.some(d => d.id === 'time.minuteOfDay')) return [];
  if (!Number.isInteger(elapsedMinutes) || elapsedMinutes < 0 || elapsedMinutes > 1440)
    throw new Error('本轮耗时必须是 0～1440 的整数分钟');
  if (state['player.registered'] === false) return [];
  const next = { ...state };
  const minute = Number.isInteger(state['time.minuteOfDay']) ? state['time.minuteOfDay'] : 540;
  const total = minute + elapsedMinutes;
  const days = Math.floor(total / 1440);
  const remaining = total % 1440;
  next['time.minuteOfDay'] = remaining;
  next['time.day'] = (Number(state['time.day']) || 1) + days;
  next['time.clock'] = String(Math.floor(remaining / 60)).padStart(2, '0') + ':' + String(remaining % 60).padStart(2, '0');
  next['time.period'] = remaining < 360 || remaining >= 1080 ? '夜晚' : remaining < 540 ? '清晨' : remaining < 720 ? '上午' : '下午';
  // This optional daily charge is configured by the story, not by the model.
  const charge = amount => {
    if (next['shop.coins'] >= amount) next['shop.coins'] -= amount;
    else next['finance.arrears'] += amount;
    next['finance.totalExpenses'] += amount;
  };
  const economy = ['time.dailyCost', 'shop.coins', 'finance.arrears', 'finance.totalExpenses', 'finance.daysSinceRent'].every(key => typeof next[key] === 'number');
  for (let i = 0; i < days; i++) {
    if ('shop.todayRevenue' in next) next['shop.todayRevenue'] = 0;
    if ('main.postRevealDays' in next) next['main.postRevealDays']++;
    if (economy) {
      charge(next['time.dailyCost']);
      next['finance.daysSinceRent']++;
      if (typeof next['time.rentCost'] === 'number' && next['finance.daysSinceRent'] >= 30) {
        charge(next['time.rentCost']);
        next['finance.daysSinceRent'] -= 30;
      }
    }
  }
  const defined = new Set(book.stateSchema.map(d => d.id));
  return Object.keys(next).filter(key => defined.has(key) && next[key] !== state[key])
    .map(target => ({ type: 'set', target, value: next[target] }));
}

export const clockPrompt = '隐藏游戏时间协议：回复 JSON 顶层必须包含 elapsedMinutes（0～1440 的整数，单位分钟），仅表示本轮正文中新发生的活动耗时。不要在 narrative、choices 或摘要里输出该字段、JSON或隐藏标签。当前时刻读取 time.day 与 time.clock；程序在成功提交后推进时钟、换日并同步动态栏，禁止通过 operations 修改 time.*。短对话通常0～3分钟，短途移动约5～20分钟，完整护理按体型和项目约30～90分钟，明确等待、休息按实际时长；这些是参考，不是每轮固定加时。护理分多轮时只算本轮新增部分，边护理边聊天是重叠时间不能相加。已发生的护理、收费、睡觉按钮和活动记录的回顾不再次计时；如果结算后才补叙此前未演出的护理，也不补收历史耗时。查看手册、背包、设置、星网页面、规则解释或没有实际推进时填0。不得把现实等待API的时间算入游戏。不得自动替玩家睡觉、结束营业或跳过未决定的剧情。';
