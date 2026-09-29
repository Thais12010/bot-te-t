const crypto = require('crypto');
const backup = require('./backup');

const BACKUP_ENABLED = !!process.env.GITHUB_TOKEN;
const SWEEP_MS = (parseInt(process.env.BACKUP_SWEEP_SECONDS, 10) || 30) * 1000;
const DEFAULT_SETTINGS = { saveHistory: true, maxHistory: 100 };
const isSnowflake = (s) => /^\d{15,25}$/.test(String(s));

// { [discordId]: { username(=discordId), displayName, createdAt, history[], settings } }
let USERS = {};
const USER_HASHES = {};
const backupQueue = new Set();

const hashUser = (u) => crypto.createHash('md5').update(JSON.stringify(u)).digest('hex');

async function init() {
    if (!BACKUP_ENABLED) {
        console.log('⚠️  Auto backup TẮT (thiếu GITHUB_TOKEN) — dữ liệu sẽ mất khi restart');
        return;
    }
    console.log('🔄 Đang tải dữ liệu từ GitHub...');
    try {
        const remote = await backup.loadAllUsers();
        for (const [id, u] of Object.entries(remote || {})) {
            // chỉ nạp user Discord (bỏ qua tài khoản web cũ như "admin")
            if (!isSnowflake(id)) continue;
            USERS[id] = { ...u, settings: { ...DEFAULT_SETTINGS, ...(u.settings || {}) }, history: u.history || [] };
            USER_HASHES[id] = hashUser(USERS[id]);
        }
        console.log(`✅ Đã nạp ${Object.keys(USERS).length} user Discord`);
    } catch (err) {
        console.error('❌ Lỗi tải dữ liệu:', err.message);
    }
    setInterval(sweep, SWEEP_MS);
    console.log(`⏰ Auto backup bật — quét mỗi ${SWEEP_MS / 1000}s`);
}

// Lấy (hoặc tạo mới) user theo Discord user
function getUser(discordUser) {
    const id = discordUser.id;
    const name = discordUser.globalName || discordUser.username;
    if (!USERS[id]) {
        USERS[id] = {
            username: id,
            displayName: name,
            createdAt: Date.now(),
            history: [],
            settings: { ...DEFAULT_SETTINGS }
        };
    } else if (USERS[id].displayName !== name) {
        USERS[id].displayName = name;
    }
    return USERS[id];
}

async function backupUser(id, force = false) {
    if (!BACKUP_ENABLED || !USERS[id]) return;
    const snapshot = hashUser(USERS[id]);
    if (!force && snapshot === USER_HASHES[id]) return;
    if (backupQueue.has(id)) return;
    backupQueue.add(id);
    try {
        const r = await backup.saveUser(USERS[id]);
        USER_HASHES[id] = snapshot; // hash của đúng dữ liệu vừa lưu, tránh mất cập nhật xảy ra lúc đang upload
        console.log(`✅ [${id}] backup OK (${r.successCount}/${r.totalMirrors} files)`);
    } catch (err) {
        console.error(`❌ [${id}] backup lỗi:`, err.message);
    } finally {
        backupQueue.delete(id);
    }
}

const triggerBackup = (id) => setTimeout(() => backupUser(id), 0);

function sweep() {
    for (const id of Object.keys(USERS)) backupUser(id);
}

async function backupAll() {
    const ids = Object.keys(USERS);
    for (const id of ids) await backupUser(id, true);
    return ids.length;
}

function addHistory(user, entry) {
    if (!user.settings.saveHistory) return;
    user.history.unshift(entry);
    user.history = user.history.slice(0, user.settings.maxHistory);
}

const allUsers = () => Object.values(USERS);

module.exports = {
    BACKUP_ENABLED, DEFAULT_SETTINGS,
    init, getUser, addHistory, triggerBackup, backupAll, allUsers
};
