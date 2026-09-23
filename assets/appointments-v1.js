const sizes = ['小型', '中型', '大型'];
const services = ['基础清洗', '深度按摩', '特殊护理'];
const core = { 沈择岸: 'zean', 沈择川: 'shen', 江晏澈: 'jiang', 阮星辞: 'ruan', 慕容晔: 'murong', 夜阑: 'yelan' };
const templates = { 林澄: '首位顾客', 唐沐: '唐沐', 贺远: '贺远', 苏青禾: '苏青禾', 周予安: '周予安' };
const enabled = book => book.stateSchema.some(d => d.id === 'booking.notice');
const stamp = (day, minute) => (day - 1) * 1440 + minute;
export function bookingTime(row) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(row.time);
  return match && row.day >= 1 ? stamp(row.day, +match[1] * 60 + +match[2]) : null;
}
export function queue(snapshot) {
  const now = stamp(Number(snapshot.state['time.day']) || 1, Number(snapshot.state['time.minuteOfDay']) || 0);
  return (snapshot.shopBookings || []).filter(b => b.status === '预约中')
    .map(b => ({ ...b, remaining: bookingTime(b) === null ? null : bookingTime(b) - now }))
    .sort((a, b) => (bookingTime(a) ?? Infinity) - (bookingTime(b) ?? Infinity));
}
export function bookingNotice(snapshot) {
  const active = snapshot.state['booking.activeId'];
  const rows = queue(snapshot), current = rows.find(b => b.id === active);
  const waiting = rows.filter(b => b.id !== active && b.remaining !== null && b.remaining <= 0);
  const upcoming = rows.find(b => b.id !== active && b.remaining > 0);
  let note = current ? '正在接待预约客人：' + current.npc : '';
  if (waiting.length) note += (note ? '；' : '') + waiting[0].npc + (snapshot.state['shop.open'] ? '已到预约时间，等候接待' : '已到预约时间，待开门接待') + (waiting.length > 1 ? '等 ' + waiting.length + ' 位' : '');
  else if (upcoming && upcoming.remaining <= 30) note += (note ? '；' : '') + upcoming.npc + '将在 ' + upcoming.remaining + ' 分钟后到店';
  else if (!note && upcoming) note = '下一位预约：第' + upcoming.day + '天 ' + upcoming.time + ' ' + upcoming.npc;
  return note || '暂无待接待预约';
}
export function syncAppointments(book, snapshot, apply) {
  if (!enabled(book)) return snapshot;
  snapshot.state = apply(book, snapshot.state, [{ type: 'set', target: 'booking.notice', value: bookingNotice(snapshot) }], false);
  return snapshot;
}
export function confirmCare(book, snapshot, confirmation, apply) {
  if (!enabled(book) || !confirmation || !confirmation.confirmed) return;
  const s = snapshot.state, current = s['shop.currentGuest'];
  if (!current || current === '无' || s['guest.settlementPending']) throw new Error('当前没有可确认服务的顾客');
  const identity = current === '普通顾客' ? s['guest.template'] : current;
  if (confirmation.guest !== identity) throw new Error('服务确认与当前顾客不一致');
  if (!sizes.includes(confirmation.size) || !services.includes(confirmation.service)) throw new Error('服务项目或体型不合法');
  snapshot.state = apply(book, s, [
    { type: 'set', target: 'care.size', value: confirmation.size },
    { type: 'set', target: 'care.service', value: confirmation.service },
    { type: 'set', target: 'guest.needKnown', value: true },
    { type: 'set', target: 'care.lastAction', value: '已根据正文确认：' + confirmation.size + ' · ' + confirmation.service },
  ], false);
}
export function handleBookingAction(book, before, panelId, id, inputs, legacy, apply, matches) {
  if (!enabled(book)) return legacy(book, before, panelId, id, inputs);
  const panel = book.extensions.find(p => p.id === panelId);
  const bookingOperation = id.startsWith('retail.booking.');
  const checkout = id.startsWith('care_checkout_');
  const activeId = before.state['booking.activeId'];
  const active = before.shopBookings.find(b => b.id === activeId && b.status === '预约中');
  let next;
  if (bookingOperation) {
    if (!panel?.retail || !matches(panel.conditions, before.state)) throw new Error('当前面板不可管理预约');
    const row = before.shopBookings.find(b => b.id === inputs.id && b.status === '预约中');
    if (!row) throw new Error('预约不存在或已处理');
    if (id === 'retail.booking.cancel' && row.id === activeId) throw new Error('请先完成正在接待的预约');
    if (id === 'retail.booking.complete') throw new Error('请先接待预约客人，再到店主手册完成护理；不会在两处重复收款');
    if (id === 'retail.booking.accept') {
      const s = before.state, first = queue(before)[0];
      if (!first || first.id !== row.id) throw new Error('请先接待时间更早的预约');
      if (first.remaining === null || first.remaining > 0) throw new Error('尚未到预约时间');
      if (!s['shop.open'] || s['world.location'] !== '一家护理小店') throw new Error('请先回店并开门营业');
      if (s['shop.currentGuest'] !== '无' || s['shop.offer'] !== '无' || s['guest.rollPending'] || s['guest.settlementPending'] || activeId !== '无') throw new Error('先处理当前顾客与门外来客，预约客人会继续等候');
      if (s['shop.supplies'] < 1) throw new Error('请先补充护理耗材');
      const key = core[row.npc];
      if (key && !s['npc.' + key + '.met']) throw new Error('尚未认识该角色，不能通过预约跳过初遇');
      const accept = book.extensions.flatMap(p => p.actions).find(a => a.id === (key ? 'accept_core_' + key : 'accept_offer'));
      if (!accept) throw new Error('当前剧本缺少接待动作');
      next = structuredClone(before);
      next.state = apply(book, next.state, accept.effects, false);
      const values = { 'booking.activeId': row.id, 'booking.customerName': row.npc, 'guest.template': key ? row.npc : templates[row.npc] || '随机顾客', 'guest.isCommission': false, 'guest.nameKnown': true, 'guest.needKnown': false, 'guest.animalObserved': false, 'guest.impression': '谨慎', 'story.lastLog': '接待预约客人' + row.npc + '，服务需求可在正文确认。' };
      next.state = apply(book, next.state, Object.entries(values).map(([target, value]) => ({ type: 'set', target, value })), false);
      // A name alone is not enough to infer body size or sell an extra service.
    } else next = legacy(book, before, panelId, id, inputs);
  } else if (checkout && active) {
    const action = panel?.actions.find(a => a.id === id);
    if (!action || !matches(panel.conditions, before.state) || !matches(action.conditions, before.state)) throw new Error('当前无法完成护理');
    next = structuredClone(before);
    const effects = active.paid ? action.effects.filter(o => o.target !== 'shop.coins' && o.target !== 'shop.todayRevenue') : action.effects;
    next.state = apply(book, next.state, effects, false);
    const row = next.shopBookings.find(b => b.id === active.id);
    if (!row.paid) {
      row.total = action.effects.find(o => o.target === 'shop.coins').value;
      row.paid = true;
      next.shopSales.push({ id: crypto.randomUUID(), npc: row.npc, productId: row.productId || 'offline-service', productName: row.productName, quantity: 1, total: row.total, turn: next.turnNumber });
    }
    row.completedUnits = (row.completedUnits || 0) + 1;
    row.status = row.completedUnits >= row.quantity ? '已完成' : '预约中';
    next.state = apply(book, next.state, [
      { type: 'set', target: 'booking.activeId', value: '无' },
      { type: 'set', target: 'booking.customerName', value: '无' },
      { type: 'set', target: 'story.lastLog', value: row.npc + '的预约护理已完成，' + (active.paid ? '线上已付款，本次不重复收费。' : '本次收款' + row.total + '星币。') },
    ], false);
  } else next = legacy(book, before, panelId, id, inputs);
  return syncAppointments(book, next, apply);
}
export const appointmentPrompt = '预约与服务确认协议：shopBookings是唯一预约记录，booking.notice为程序计算的提醒，booking.activeId和booking.customerName为当前已接待预约。未到预约时间不让客人提前出现；到时可简短描写门外等候，不改变当前顾客、不打断正在进行的护理。即使到时，仍需玩家在预订单点击接待；打烊或外出时只提示到时待接待。已有预约不可每轮重复提交，不得用预约跳过尚未认识角色的初遇。询价、提议、未确定时间不等于正式预约。当前顾客明确确认体型与服务时，回复可附带careConfirmation:{guest:"身份键",confirmed:true,size:"小型/中型/大型",service:"基础清洗/深度按摩/特殊护理"}；普通顾客身份键严格复制guest.template，核心顾客复制shop.currentGuest。只是询价、猜测、举例、回顾旧单或讨论其他客人时省略此字段；同一确认只提交一次，玩家后来在面板手动调整后不得用旧确认覆盖。字段是隐藏数据，不要写入正文。预约商品名称不够明确时先沟通，不能猜测体型；线上已付款由程序防止重复收费。';
