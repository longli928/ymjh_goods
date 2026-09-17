// 兑换结果关键字（按顺序匹配接口返回的 msg）
const REDEEM_KEYWORDS = ['兑换码不存在', '已领取过', '兑换码已过期'];

// 导入数量限制
const MAX_GROUPS = 20;
const MAX_ROLES_PER_GROUP = 20;

// 接口地址与请求间隔
const ROLE_CHECK_API = 'https://com-sev.webapp.163.com/h42cdkey_role_check/api';
const REDEEM_API = 'https://com-sev.webapp.163.com/h42cdkey_redeem/api';
const NAME_QUERY_GAP = 200;
const REDEEM_GAP = 300;
const REQUEST_TIMEOUT = 15000;

const serverNames = Object.keys(SERVER_DATA);

const importInput = document.getElementById('importInput');
const importBtn = document.getElementById('importBtn');
const groupsEl = document.getElementById('groups');
const addBtn = document.getElementById('addBtn');
const codesInput = document.getElementById('codesInput');
const serverList = document.getElementById('serverList');
const startBtn = document.getElementById('startBtn');
const checkAllBtn = document.getElementById('checkAllBtn');
const stopBtn = document.getElementById('stopBtn');
const formArea = document.getElementById('formArea');
const summaryDiv = document.getElementById('summary');
const progressDiv = document.getElementById('progress');
const resultTable = document.getElementById('resultTable');
const resultBody = document.getElementById('resultBody');
const failSection = document.getElementById('failSection');
const failList = document.getElementById('failList');
const copyFailBtn = document.getElementById('copyFailBtn');
const dialogMask = document.getElementById('dialog');
const dialogTitle = document.getElementById('dialogTitle');
const dialogBody = document.getElementById('dialogBody');
const dialogOk = document.getElementById('dialogOk');
const dialogCancel = document.getElementById('dialogCancel');

let running = false;
const roleNameCache = new Map();
const failRoles = new Map();

// ===== 小工具 =====
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const escapeHtml = str => String(str == null ? '' : str).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[ch]));

// 按逗号/空格/换行等分隔符切分输入
function splitTokens(text) {
    return text.split(/[\s,，、;；]+/).map(s => s.trim()).filter(Boolean);
}

// ===== 大区名称下拉提示 =====
serverNames.forEach(name => {
    const option = document.createElement('option');
    option.value = name;
    serverList.appendChild(option);
});

// ===== JSONP 请求（浏览器直接请求游戏接口，不经过本站服务器） =====
let jsonpSeq = 0;

function jsonp(url, params) {
    return new Promise(resolve => {
        const cbName = 'jsonp_cb_' + (++jsonpSeq) + '_' + Date.now();
        const query = Object.assign({}, params, {
            _: Date.now(),
            callback: cbName
        });
        const src = url + '?' + Object.keys(query).map(k =>
            encodeURIComponent(k) + '=' + encodeURIComponent(query[k])
        ).join('&');

        const script = document.createElement('script');
        let done = false;

        const finish = result => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            delete window[cbName];
            script.remove();
            resolve(result);
        };

        const timer = setTimeout(() => finish({ ok: false, error: '请求超时' }), REQUEST_TIMEOUT);

        window[cbName] = data => finish({ ok: true, data });

        script.onerror = () => finish({ ok: false, error: '请求失败' });
        script.src = src;
        document.body.appendChild(script);
    });
}

// 查询角色名，结果按 大区ID:角色ID 缓存
async function fetchRoleName(roleId, hostnum, force) {
    const key = hostnum + ':' + roleId;
    if (!force && roleNameCache.has(key)) return roleNameCache.get(key);

    const res = await jsonp(ROLE_CHECK_API, { role_id: roleId, hostnum: hostnum });
    const info = {
        roleId: roleId,
        name: res.ok && res.data && res.data.status === true ? (res.data.nickname || '') : '',
        raw: res.ok ? res.data : { error: res.error }
    };
    roleNameCache.set(key, info);
    return info;
}

const formatRole = task => task.roleName
    ? `${task.roleName}（角色ID ${task.roleId}）`
    : `角色ID ${task.roleId}`;

// 归类兑换结果
function parseRedeemResult(raw) {
    if (raw && raw.status === true) {
        return { ok: true, text: '兑换成功' };
    }
    const msg = raw && raw.msg ? String(raw.msg) : '兑换失败';
    const hit = REDEEM_KEYWORDS.find(word => msg.includes(word));
    return { ok: false, text: hit || msg };
}

// ===== 大区分组 =====
function createGroup(name = '') {
    const row = document.createElement('div');
    row.className = 'group-row';
    row.innerHTML = `
        <div class="g-top">
            <input type="text" class="server-name" list="serverList" autocomplete="off"
                placeholder="大区名字，例如：踏月留香" value="${escapeHtml(name)}">
            <input type="hidden" class="server-id">
            <button type="button" class="del danger-ghost">删除</button>
        </div>
        <div class="g-hint hint">写上大区名字，会自动识别是哪个大区</div>
        <textarea class="roles" placeholder="这个区的角色ID：一行写一个，也可以用空格或逗号隔开"></textarea>
        <div class="g-names"></div>
    `;

    const nameInput = row.querySelector('.server-name');
    const rolesInput = row.querySelector('.roles');

    nameInput.addEventListener('input', () => matchServerId(row));
    rolesInput.addEventListener('input', () => {
        row.querySelector('.g-names').innerHTML = '';
    });
    row.querySelector('.del').addEventListener('click', () => {
        row.remove();
        if (groupsEl.querySelectorAll('.group-row').length === 0) groupsEl.appendChild(createGroup());
    });

    groupsEl.appendChild(row);
    matchServerId(row);
    return row;
}

// 根据大区名称匹配大区ID（ID 不展示给用户）
function matchServerId(row) {
    const nameInput = row.querySelector('.server-name');
    const idInput = row.querySelector('.server-id');
    const hint = row.querySelector('.g-hint');
    const name = nameInput.value.trim();

    idInput.value = '';

    if (!name) {
        hint.className = 'g-hint hint';
        hint.textContent = '写上大区名字，会自动识别是哪个大区';
        return;
    }

    // 1. 完全匹配
    if (SERVER_DATA[name]) {
        idInput.value = SERVER_DATA[name];
        hint.className = 'g-hint hint ok';
        hint.textContent = `已识别大区：${name}`;
        return;
    }

    // 2. 模糊匹配（唯一命中时自动填充）
    const fuzzy = serverNames.filter(n => n.includes(name) || name.includes(n));
    if (fuzzy.length === 1) {
        idInput.value = SERVER_DATA[fuzzy[0]];
        hint.className = 'g-hint hint ok';
        hint.textContent = `已识别大区：${name}（${fuzzy[0]}）`;
        return;
    }

    hint.className = 'g-hint hint bad';
    hint.textContent = fuzzy.length > 1
        ? `有 ${fuzzy.length} 个大区名字里都带这几个字（${fuzzy.slice(0, 5).join('、')}...），请把大区名字写完整`
        : '没找到这个大区，请检查名字有没有写错';
}

// 读取并校验一行大区，返回 null 表示校验不通过
function readGroup(row, index) {
    const name = row.querySelector('.server-name').value.trim();
    const hostnum = row.querySelector('.server-id').value.trim();
    const roles = splitTokens(row.querySelector('.roles').value);

    if (!hostnum) {
        alert(`第 ${index + 1} 行的「${name || '（没写大区名）'}」找不到这个大区，请检查大区名字有没有写错。`);
        row.querySelector('.server-name').focus();
        return null;
    }
    if (roles.length === 0) {
        alert(`第 ${index + 1} 行的「${name || hostnum}」还没有填角色ID，无法兑换。`);
        row.querySelector('.roles').focus();
        return null;
    }
    const bad = roles.filter(r => !/^\d+$/.test(r));
    if (bad.length) {
        alert(`第 ${index + 1} 行的「${name || hostnum}」里，角色ID写错了：${bad.slice(0, 5).join('、')}。角色ID只能是数字，请检查后重填。`);
        row.querySelector('.roles').focus();
        return null;
    }

    return { row, name: name || hostnum, hostnum, roles };
}

function collectGroups() {
    const groupRows = [...groupsEl.querySelectorAll('.group-row')];
    if (groupRows.length === 0) {
        alert('还没有角色可以兑换，请先在「一键导入」里导入角色，或点「+ 添加大区」手动填写。');
        return null;
    }

    const groups = [];
    for (let i = 0; i < groupRows.length; i++) {
        const group = readGroup(groupRows[i], i);
        if (!group) return null;
        groups.push(group);
    }
    return groups;
}

// ===== 弹窗 =====
function showDialog({ title, bodyHtml, okText = '确定', cancelText = null }) {
    return new Promise(resolve => {
        dialogTitle.textContent = title;
        dialogBody.innerHTML = bodyHtml;
        dialogOk.textContent = okText;
        dialogCancel.style.display = cancelText ? '' : 'none';
        if (cancelText) dialogCancel.textContent = cancelText;
        dialogMask.style.display = 'flex';

        const finish = ok => {
            dialogMask.style.display = 'none';
            dialogOk.removeEventListener('click', onOk);
            dialogCancel.removeEventListener('click', onCancel);
            resolve(ok);
        };
        const onOk = () => finish(true);
        const onCancel = () => finish(false);

        dialogOk.addEventListener('click', onOk);
        dialogCancel.addEventListener('click', onCancel);
    });
}

// 开始前的确认框，点「已知晓并开始」才返回 true
function confirmLeaveNotice(countText) {
    return showDialog({
        title: '开始兑换前，请先看一眼',
        bodyHtml:
            '<p>本次将由你电脑上的浏览器逐个发送兑换请求，'
            + '<span class="warn">中途请不要关闭、刷新页面，也不要切走或让电脑休眠</span>，'
            + '否则还没兑换完的角色会直接中断（已经兑换成功的不会退回）。</p>'
            + '<p>请求之间有间隔，角色一多会比较慢。</p>'
            + `<p class="warn">${escapeHtml(countText)}</p>`,
        okText: '已知晓并开始',
        cancelText: '取消'
    });
}

// 兑换未完成时离开/刷新页面给出提示
window.addEventListener('beforeunload', e => {
    if (!running) return;
    e.preventDefault();
    e.returnValue = '兑换还没完成，离开页面会中断本次兑换。';
    return e.returnValue;
});

// 统一控制运行中的按钮/表单状态
function setBusy(busy) {
    running = busy;
    startBtn.disabled = busy;
    checkAllBtn.disabled = busy;
    stopBtn.disabled = !busy;
    formArea.classList.toggle('is-busy', busy);
}

// ===== 从文本一键导入 =====
// 格式：大区名,角色ID1 角色ID2;大区名2,角色ID1 角色ID2;
function parseImportText(text) {
    const segments = text.split(/[;；]/).map(s => s.trim()).filter(Boolean);
    if (segments.length === 0) return { error: '还没有内容，请先把角色信息粘贴到上面的框里。' };

    const groups = [];
    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const commaIndex = seg.search(/[,，]/);
        if (commaIndex < 0) {
            return { error: `第 ${i + 1} 段「${seg}」里没找到逗号。大区名字和角色ID之间必须用逗号隔开，例如：人间如梦,1234567890` };
        }

        const name = seg.slice(0, commaIndex).trim();
        const roles = splitTokens(seg.slice(commaIndex + 1));

        if (!name) return { error: `第 ${i + 1} 段开头没有写大区名字，例如：人间如梦,1234567890` };
        if (roles.length === 0) return { error: `第 ${i + 1} 段（${name}）逗号后面没有写角色ID。` };

        const bad = roles.filter(r => !/^\d+$/.test(r));
        if (bad.length) {
            return { error: `第 ${i + 1} 段（${name}）里的角色ID写错了：${bad.slice(0, 5).join('、')}。角色ID只能是数字，多个角色ID之间用空格隔开。` };
        }
        groups.push({ name, roles });
    }

    if (groups.length > MAX_GROUPS) {
        return { error: `最多只能导入 ${MAX_GROUPS} 个大区，你填了 ${groups.length} 个，请删掉一些再试。` };
    }
    const tooMany = groups.find(g => g.roles.length > MAX_ROLES_PER_GROUP);
    if (tooMany) {
        return { error: `大区「${tooMany.name}」填了 ${tooMany.roles.length} 个角色，每个大区最多只能 ${MAX_ROLES_PER_GROUP} 个，请删掉一些再试。` };
    }

    return { groups };
}

importBtn.addEventListener('click', () => {
    if (running) return;

    const parsed = parseImportText(importInput.value);
    if (parsed.error) {
        alert(parsed.error);
        return;
    }

    groupsEl.innerHTML = '';
    failRoles.clear();
    resultBody.innerHTML = '';
    failList.innerHTML = '';
    failSection.style.display = 'none';
    resultTable.style.display = 'none';
    summaryDiv.innerHTML = '';
    progressDiv.textContent = '';

    parsed.groups.forEach(group => {
        const row = createGroup(group.name);
        row.querySelector('.roles').value = group.roles.join('\n');
    });

    const roleCount = parsed.groups.reduce((n, g) => n + g.roles.length, 0);
    progressDiv.textContent = `导入成功：共 ${parsed.groups.length} 个大区、${roleCount} 个角色，请核对下面的信息。`;
});

addBtn.addEventListener('click', () => {
    if (groupsEl.querySelectorAll('.group-row').length >= MAX_GROUPS) {
        alert(`最多只能添加 ${MAX_GROUPS} 个大区，已经满了。`);
        return;
    }
    const row = createGroup();
    row.querySelector('.server-name').focus();
});

// ===== 批量查询角色名 =====
function renderRoleNames(group, results) {
    const out = group.row.querySelector('.g-names');
    out.innerHTML = results.map(info => {
        if (info.name) {
            return `<span class="name-item">${escapeHtml(info.name)}（角色ID ${escapeHtml(info.roleId)}）</span>`;
        }
        const msg = info.raw && info.raw.msg ? info.raw.msg : '查询失败';
        return `<span class="name-item error">角色 ${escapeHtml(info.roleId)} 查不到：${escapeHtml(msg)}</span>`;
    }).join('');
}

checkAllBtn.addEventListener('click', async () => {
    if (running) return;

    const groups = collectGroups();
    if (!groups) return;

    const total = groups.reduce((n, g) => n + g.roles.length, 0);
    let done = 0;

    setBusy(true);
    progressDiv.textContent = `正在查询角色名：已完成 0 / 共 ${total} 个角色`;

    for (const group of groups) {
        const results = [];
        group.row.querySelector('.g-names').textContent = '正在查询角色名...';
        for (const roleId of group.roles) {
            if (!running) break;
            results.push(await fetchRoleName(roleId, group.hostnum, true));
            done++;
            progressDiv.textContent = `正在查询角色名：已完成 ${done} / 共 ${total} 个角色`;
            await sleep(NAME_QUERY_GAP);
        }
        renderRoleNames(group, results);
        if (!running) break;
    }

    setBusy(false);
    progressDiv.textContent = done < total
        ? `已停止，只查询了 ${done} / 共 ${total} 个角色`
        : `角色名查询完成，共 ${total} 个角色`;
});

// ===== 批量兑换 =====
startBtn.addEventListener('click', async () => {
    if (running) return;

    const groups = collectGroups();
    if (!groups) return;

    const codes = splitTokens(codesInput.value);
    if (codes.length === 0) {
        alert('还没有填兑换码，请先在「填写兑换码」的框里填写至少一个兑换码。');
        return;
    }

    // 开始前先弹确认框，用户点「已知晓并开始」后才真正开始
    const roleTotal = groups.reduce((n, g) => n + g.roles.length, 0);
    const agree = await confirmLeaveNotice(
        `本次共 ${groups.length} 个大区、${roleTotal} 个角色、${codes.length} 个兑换码，`
        + `需要发送 ${roleTotal * codes.length} 次兑换请求。`);
    if (!agree) return;

    setBusy(true);

    // 先把还没查过的角色名补查一遍
    const pending = [];
    groups.forEach(group => group.roles.forEach(roleId => {
        if (!roleNameCache.has(group.hostnum + ':' + roleId)) {
            pending.push({ group, roleId });
        }
    }));

    if (pending.length) {
        let queried = 0;
        progressDiv.textContent = `正在查询角色名：已完成 0 / 共 ${pending.length} 个角色`;
        for (const item of pending) {
            if (!running) break;
            await fetchRoleName(item.roleId, item.group.hostnum, false);
            queried++;
            progressDiv.textContent = `正在查询角色名：已完成 ${queried} / 共 ${pending.length} 个角色`;
            await sleep(NAME_QUERY_GAP);
        }
        if (!running) {
            setBusy(false);
            progressDiv.textContent = '已停止：还没有开始兑换。';
            return;
        }
    }

    // 展开成「大区 × 角色 × 兑换码」任务列表
    const tasks = [];
    groups.forEach(group => group.roles.forEach(roleId => {
        const cached = roleNameCache.get(group.hostnum + ':' + roleId);
        codes.forEach(code => {
            tasks.push({
                group,
                roleId,
                roleName: cached && cached.name ? cached.name : '',
                code
            });
        });
    }));

    // 初始化结果表格
    resultBody.innerHTML = '';
    resultTable.style.display = '';
    failRoles.clear();
    failList.innerHTML = '';
    failSection.style.display = 'none';
    summaryDiv.innerHTML = '';

    let success = 0;
    let fail = 0;
    let done = 0;
    const groupStats = groups.map(g => ({ name: g.name, hostnum: g.hostnum, success: 0, fail: 0 }));

    const renderSummary = () => {
        summaryDiv.innerHTML = `<div class="total">兑换结果：共 ${tasks.length} 条，成功 ${success} 条，失败 ${fail} 条</div>`
            + groupStats.map(s =>
                `<div class="line">${escapeHtml(s.name)}：成功 ${s.success} 条，失败 ${s.fail} 条</div>`
            ).join('');
    };

    const renderFailList = () => {
        const items = [...failRoles.values()];
        failSection.style.display = items.length ? '' : 'none';
        failList.innerHTML = items.map(it =>
            `<div class="fail-item">${escapeHtml(it.name)} / ${escapeHtml(it.roleId)} / ${escapeHtml(it.roleName || '没查到角色名')}</div>`
        ).join('');
    };

    tasks.forEach((task, i) => {
        const tr = document.createElement('tr');
        tr.className = 'pending';
        tr.innerHTML = `<td>${i + 1}</td>`
            + `<td>${escapeHtml(task.group.name)}</td>`
            + `<td>${escapeHtml(formatRole(task))}</td>`
            + `<td>${escapeHtml(task.code)}</td>`
            + `<td class="status">等待中</td>`;
        task.tr = tr;
        resultBody.appendChild(tr);
    });

    for (const task of tasks) {
        if (!running) break;

        progressDiv.textContent = `正在兑换：第 ${done + 1} / 共 ${tasks.length} 条　—　`
            + `${task.group.name} / ${formatRole(task)} / 兑换码 ${task.code}`;

        const res = await jsonp(REDEEM_API, {
            role_id: task.roleId,
            hostnum: task.group.hostnum,
            code: task.code
        });
        const raw = res.ok ? res.data : { error: res.error };
        const parsed = parseRedeemResult(raw);
        const statusCell = task.tr.querySelector('.status');

        task.tr.className = parsed.ok ? 'success' : 'error';
        statusCell.innerHTML = `<a>${escapeHtml(parsed.text)}</a>`;
        statusCell.querySelector('a').addEventListener('click', () => toggleDetail(task, raw));

        const stat = groupStats.find(s => s.hostnum === task.group.hostnum);
        if (parsed.ok) {
            success++;
            stat.success++;
        } else {
            fail++;
            stat.fail++;
            const key = task.group.hostnum + ':' + task.roleId + ':' + task.group.name;
            if (!failRoles.has(key)) {
                failRoles.set(key, {
                    name: task.group.name,
                    roleId: task.roleId,
                    roleName: task.roleName
                });
            }
        }

        done++;
        renderSummary();
        renderFailList();
        await sleep(REDEEM_GAP);
    }

    setBusy(false);
    if (done < tasks.length) {
        progressDiv.textContent = `已停止：只完成了 ${done} / 共 ${tasks.length} 条`;
    } else {
        progressDiv.textContent = `兑换全部完成：共 ${tasks.length} 条`;
        await showDialog({
            title: '兑换完成',
            bodyHtml: `<p>共 ${tasks.length} 条兑换：成功 <b>${success}</b> 条，失败 <span class="warn">${fail}</span> 条。</p>`
                + '<p>现在可以离开页面了。</p>',
            okText: '好的'
        });
    }
});

// 展开/收起某条结果的原始返回
function toggleDetail(task, raw) {
    const next = task.tr.nextElementSibling;
    if (next && next.classList.contains('detail')) {
        next.remove();
        return;
    }

    const detail = document.createElement('tr');
    detail.className = 'detail';
    detail.innerHTML = `<td colspan="5"><pre>${escapeHtml(JSON.stringify(raw))}</pre></td>`;
    task.tr.after(detail);
}

stopBtn.addEventListener('click', () => {
    if (running) stopBtn.textContent = '正在停止...';
    running = false;
});

// ===== 复制失败名单 =====
// 输出格式：大区名1,角色id1,角色id2;大区名2,角色id1,角色id2;
function buildFailCopyText() {
    const order = [];
    const map = new Map();

    failRoles.forEach(item => {
        if (!map.has(item.name)) {
            map.set(item.name, []);
            order.push(item.name);
        }
        map.get(item.name).push(item.roleId);
    });

    return order.map(name => name + ',' + map.get(name).join(',')).join(';') + ';';
}

async function copyText(text) {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (e) {
        // 继续走下面的兜底方案
    }

    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();

    let ok = false;
    try {
        ok = document.execCommand('copy');
    } catch (e) {
        ok = false;
    }
    ta.remove();
    return ok;
}

copyFailBtn.addEventListener('click', async () => {
    if (failRoles.size === 0) {
        alert('目前没有兑换失败的角色，不需要复制。');
        return;
    }
    const text = buildFailCopyText();
    const ok = await copyText(text);
    if (ok) {
        const old = copyFailBtn.textContent;
        copyFailBtn.textContent = '已复制';
        setTimeout(() => { copyFailBtn.textContent = old; }, 1500);
    } else {
        alert('浏览器不允许自动复制，请手动复制下面的内容：\n\n' + text);
    }
});

// ===== 收集的公开兑换码（内容来自 goods/code.md，默认折叠，展开时才加载） =====
const codesBox = document.getElementById('codesBox');
const codesTableWrap = document.getElementById('codesTableWrap');
const copyCodesBtn = document.getElementById('copyCodesBtn');

let publicCodes = null;
let codesLoading = false;

// 解析 markdown 表格，返回 { headers, rows }
function parseMarkdownTable(text) {
    const rows = text.split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.startsWith('|') && line.endsWith('|'))
        .map(line => line.slice(1, -1).split('|').map(cell => cell.trim()))
        .filter(cells => !cells.every(cell => /^:?-{2,}:?$/.test(cell)));

    if (rows.length === 0) return null;
    return { headers: rows[0], rows: rows.slice(1) };
}

function renderPublicCodes() {
    codesTableWrap.innerHTML = '<table><thead><tr>'
        + publicCodes.headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')
        + '</tr></thead><tbody>'
        + publicCodes.rows.map(row => `<tr>${row.map(c => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')
        + '</tbody></table>';
}

async function loadPublicCodes() {
    if (codesLoading || publicCodes) return;
    codesLoading = true;

    try {
        const res = await fetch('goods/code.md', { cache: 'no-cache' });
        if (!res.ok) throw new Error('HTTP ' + res.status);

        const parsed = parseMarkdownTable(await res.text());
        if (!parsed) throw new Error('文件中没有找到表格');

        publicCodes = parsed;
        renderPublicCodes();
    } catch (e) {
        codesTableWrap.innerHTML = `<div class="hint bad">读取 goods/code.md 失败（${escapeHtml(e.message)}）。`
            + '如果是直接双击打开网页，浏览器会禁止读取本地文件，请改用服务器地址访问本站。</div>';
        copyCodesBtn.disabled = true;
    } finally {
        codesLoading = false;
    }
}

codesBox.addEventListener('toggle', () => {
    if (codesBox.open) loadPublicCodes();
});

copyCodesBtn.addEventListener('click', async () => {
    if (!publicCodes) return;

    const codes = publicCodes.rows.map(row => row[0]).filter(Boolean);
    if (codes.length === 0) {
        alert('清单里还没有兑换码。');
        return;
    }

    const ok = await copyText(codes.join('\n'));
    if (ok) {
        const old = copyCodesBtn.textContent;
        copyCodesBtn.textContent = '已复制';
        setTimeout(() => { copyCodesBtn.textContent = old; }, 1500);
    } else {
        alert('浏览器不允许自动复制，请手动复制下面的内容：\n\n' + codes.join('\n'));
    }
});

// ===== 页脚横幅：翻到页面底部时浮现，向上翻自动隐藏 =====
const siteFooter = document.querySelector('.site-footer');

function updateFooterBanner() {
    const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 24;
    siteFooter.classList.toggle('is-visible', atBottom);
}

window.addEventListener('scroll', updateFooterBanner, { passive: true });
window.addEventListener('resize', updateFooterBanner);
updateFooterBanner();

// 初始化一行空分组
createGroup();