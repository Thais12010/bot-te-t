const crypto = require('crypto');
const axios = require('axios');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO || 'jeuwiw36/Backup-web-mmo';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const BACKUP_SECRET = process.env.BACKUP_SECRET || 'default-insecure-secret';

const MIRROR_COUNT = parseInt(process.env.BACKUP_MIRRORS, 10) || 10;
const DATA_DIR = 'data';

const GITHUB_API = 'https://api.github.com';

// ========== MÃ HOÁ AES-256-GCM ==========
function deriveKey(secret) {
    return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(plaintext, secret) {
    const key = deriveKey(secret);
    const iv = crypto.randomBytes(12);
    const salt = crypto.randomBytes(16);
    const derivedKey = crypto.createHash('sha256').update(Buffer.concat([key, salt])).digest();

    const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return Buffer.concat([salt, iv, authTag, encrypted]);
}

function decrypt(buffer, secret) {
    const key = deriveKey(secret);
    const salt = buffer.subarray(0, 16);
    const iv = buffer.subarray(16, 28);
    const authTag = buffer.subarray(28, 44);
    const ciphertext = buffer.subarray(44);

    const derivedKey = crypto.createHash('sha256').update(Buffer.concat([key, salt])).digest();
    const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// ========== GITHUB HELPERS ==========
function githubHeaders() {
    return {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'ShortTool-Backup'
    };
}

async function getFileSha(filePath) {
    try {
        const url = `${GITHUB_API}/repos/${GITHUB_REPO}/contents/${filePath}`;
        const res = await axios.get(url, {
            headers: githubHeaders(),
            params: { ref: GITHUB_BRANCH }
        });
        return res.data.sha;
    } catch (err) {
        if (err.response?.status === 404) return null;
        throw err;
    }
}

async function downloadFile(filePath) {
    const url = `${GITHUB_API}/repos/${GITHUB_REPO}/contents/${filePath}`;
    const res = await axios.get(url, {
        headers: githubHeaders(),
        params: { ref: GITHUB_BRANCH }
    });
    return {
        content: Buffer.from(res.data.content, 'base64'),
        sha: res.data.sha
    };
}

async function uploadFile(filePath, contentBuffer, commitMessage) {
    const sha = await getFileSha(filePath);
    const body = {
        message: commitMessage,
        content: contentBuffer.toString('base64'),
        branch: GITHUB_BRANCH
    };
    if (sha) body.sha = sha;

    const url = `${GITHUB_API}/repos/${GITHUB_REPO}/contents/${filePath}`;
    const res = await axios.put(url, body, { headers: githubHeaders() });
    return res.data;
}

// List nội dung folder trên GitHub
async function listFolder(folderPath) {
    try {
        const url = `${GITHUB_API}/repos/${GITHUB_REPO}/contents/${folderPath}`;
        const res = await axios.get(url, {
            headers: githubHeaders(),
            params: { ref: GITHUB_BRANCH }
        });
        return res.data;
    } catch (err) {
        if (err.response?.status === 404) return [];
        throw err;
    }
}

// Sanitize username thành folder name an toàn
function safeFolderName(username) {
    return username.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
}

function userFolder(username) {
    return `${DATA_DIR}/${safeFolderName(username)}`;
}

function mirrorPath(username, index) {
    return `${userFolder(username)}/info-${index}.enc.json`;
}

// ========== SAVE: BACKUP FOLDER CỦA 1 USER ==========
async function saveUser(userData) {
    if (!GITHUB_TOKEN) throw new Error('Thiếu GITHUB_TOKEN');
    if (!userData?.username) throw new Error('Thiếu username');

    const payload = {
        version: 2,
        type: 'user',
        username: userData.username,
        exportedAt: new Date().toISOString(),
        user: {
            // Lưu toàn bộ thông tin tài khoản, gồm cả các field được thêm sau này.
            ...userData,
            updatedAt: Date.now(),
        }
    };

    const encrypted = encrypt(JSON.stringify(payload, null, 2), BACKUP_SECRET);
    const folder = userFolder(userData.username);
    const commitMsg = `🔒 [${userData.username}] backup — ${new Date().toLocaleString('vi-VN')}`;

    // Push song song 10 file mirror
    const results = await Promise.allSettled(
        Array.from({ length: MIRROR_COUNT }, (_, i) =>
            uploadFile(mirrorPath(userData.username, i), encrypted, `${commitMsg} [${i}]`)
                .then(r => ({ i, ok: true }))
                .catch(err => ({ i, ok: false, error: err.response?.data?.message || err.message }))
        )
    );

    const ok = results.filter(r => r.value?.ok).length;
    const failed = results.filter(r => !r.value?.ok);

    if (ok === 0) throw new Error(`Tất cả ${MIRROR_COUNT} file lỗi cho user ${userData.username}`);

    if (failed.length > 0) {
        console.warn(`⚠️  [${userData.username}] ${failed.length}/${MIRROR_COUNT} file lỗi`);
    }

    return {
        status: 'success',
        username: userData.username,
        folder,
        totalMirrors: MIRROR_COUNT,
        successCount: ok,
        failedCount: failed.length,
        size: encrypted.length
    };
}

// ========== LOAD: TẢI DATA CỦA 1 USER ==========
async function loadUser(username) {
    if (!GITHUB_TOKEN) return null;

    for (let i = 0; i < MIRROR_COUNT; i++) {
        try {
            const { content } = await downloadFile(mirrorPath(username, i));
            const decrypted = decrypt(content, BACKUP_SECRET);
            const data = JSON.parse(decrypted);
            return data.user || null;
        } catch (err) {
            if (err.response?.status === 404) continue;
            console.warn(`⚠️  [${username}] file ${i} lỗi: ${err.message}`);
        }
    }
    return null;
}

// ========== LIST: TẤT CẢ USER FOLDERS ==========
async function listUserFolders() {
    if (!GITHUB_TOKEN) throw new Error('Thiếu GITHUB_TOKEN');
    const items = await listFolder(DATA_DIR);
    return items
        .filter(it => it.type === 'dir')
        .map(it => it.name);
}

// ========== LOAD ALL USERS ==========
// Đọc tất cả folder → nạp dict { username: userData }
async function loadAllUsers() {
    if (!GITHUB_TOKEN) return null;

    const folders = await listUserFolders();
    if (folders.length === 0) return null;

    console.log(`📥 Tìm thấy ${folders.length} folder user: ${folders.join(', ')}`);

    const users = {};
    for (const folder of folders) {
        try {
            // Thử từng file mirror trong folder
            let loaded = null;
            for (let i = 0; i < MIRROR_COUNT; i++) {
                try {
                    const { content } = await downloadFile(`${DATA_DIR}/${folder}/info-${i}.enc.json`);
                    const decrypted = decrypt(content, BACKUP_SECRET);
                    const data = JSON.parse(decrypted);
                    if (data.user?.username) {
                        loaded = data.user;
                        break;
                    }
                } catch (err) {
                    // thử file kế
                }
            }

            if (loaded) {
                users[loaded.username] = loaded;
                console.log(`  ✅ ${loaded.username} (${loaded.displayName})`);
            } else {
                console.warn(`  ❌ ${folder}: không đọc được file nào`);
            }
        } catch (err) {
            console.error(`  ❌ ${folder}:`, err.message);
        }
    }
    return users;
}

// ========== CHECK STATUS MIRRORS CỦA 1 USER ==========
async function checkUserMirrors(username) {
    if (!GITHUB_TOKEN) throw new Error('Thiếu GITHUB_TOKEN');

    const results = await Promise.allSettled(
        Array.from({ length: MIRROR_COUNT }, async (_, i) => {
            const path = mirrorPath(username, i);
            try {
                const { content, sha } = await downloadFile(path);
                const data = JSON.parse(decrypt(content, BACKUP_SECRET));
                return {
                    file: i, ok: true, path,
                    sha: sha.substring(0, 8),
                    size: content.length,
                    updatedAt: data.user?.updatedAt
                };
            } catch (err) {
                return {
                    file: i, ok: false, path,
                    error: err.response?.status === 404 ? 'chưa có' : err.message
                };
            }
        })
    );
    return results.map(r => r.value);
}

module.exports = {
    encrypt,
    decrypt,
    saveUser,
    loadUser,
    loadAllUsers,
    listUserFolders,
    checkUserMirrors,
    userFolder,
    mirrorPath,
    MIRROR_COUNT
};