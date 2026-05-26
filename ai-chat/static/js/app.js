// ========== 全局状态 ==========
const state = {
    characters: [],
    currentCharId: null,
    editingCharId: null,
    searchResult: null,
    webSearchEnabled: false,
    gameActive: false,
    _prevChatName: null,
    _prevChatAvatar: null,
};

// ========== 后台活跃（每角色独立定时器） ==========
const proactive = {
    increment: 5,
    timers: {},  // { cid: timeoutId }

    isEnabled(cid) {
        return !!localStorage.getItem("proactive_" + cid);
    },

    isWaiting(cid) {
        return !!localStorage.getItem("proactive_" + cid + "_waiting");
    },

    getLastActivity(cid) {
        var v = localStorage.getItem("proactive_" + cid + "_last");
        return v ? parseInt(v) : Date.now();
    },

    setLastActivity(cid, ts) {
        localStorage.setItem("proactive_" + cid + "_last", ts);
    },

    scheduleNext(cid) {
        if (!this.isEnabled(cid) || this.isWaiting(cid)) return;
        clearTimeout(this.timers[cid]);
        this.timers[cid] = setTimeout(() => this.tick(cid), 60000);
    },

    stop(cid) {
        clearTimeout(this.timers[cid]);
        delete this.timers[cid];
    },

    async tick(cid) {
        if (!this.isEnabled(cid) || this.isWaiting(cid)) return;

        var last = this.getLastActivity(cid);
        const minutesElapsed = (Date.now() - last) / 60000;
        const probability = Math.max(0, Math.min(3 + (minutesElapsed - 1) * this.increment, 100));

        if (cid === state.currentCharId) {
            var probEl = document.getElementById("proactiveCurProb");
            if (probEl) probEl.textContent = Math.round(probability);
        }

        if (Math.random() * 100 < probability) {
            var tickStarted = this.getLastActivity(cid);
            try {
                var data = await api("POST", "/api/chat/" + cid + "/proactive");
                if (cid === state.currentCharId) {
                    appendMessage("assistant", data.reply);
                    appendSystemMessage("💤 角色主动发起了对话");
                } else {
                    showProactiveBadge(cid);
                }
                loadCharacters();
                // 仅当用户在此期间未回复才设置等待标记
                if (this.getLastActivity(cid) === tickStarted) {
                    this.setLastActivity(cid, Date.now());
                    localStorage.setItem("proactive_" + cid + "_waiting", "1");
                }
                return;
            } catch (e) {
                console.error("主动消息失败(" + cid + "):", e);
            }
            this.setLastActivity(cid, Date.now());
        }

        this.scheduleNext(cid);
    },

    reset(cid) {
        this.setLastActivity(cid, Date.now());
        localStorage.removeItem("proactive_" + cid + "_waiting");
        hideProactiveBadge(cid);
        if (this.isEnabled(cid)) {
            this.scheduleNext(cid);
        }
    },

    enable(cid) {
        localStorage.setItem("proactive_" + cid, "1");
        localStorage.removeItem("proactive_" + cid + "_waiting");
        this.setLastActivity(cid, Date.now());
        this.scheduleNext(cid);
    },

    disable(cid) {
        localStorage.removeItem("proactive_" + cid);
        localStorage.removeItem("proactive_" + cid + "_waiting");
        hideProactiveBadge(cid);
        this.stop(cid);
    },

    initAll() {
        state.characters.forEach(function(c) {
            if (proactive.isEnabled(c.id) && !proactive.isWaiting(c.id)) {
                proactive.scheduleNext(c.id);
            }
        });
    },
};

function showProactiveBadge(cid) {
    var card = document.querySelector('.char-card[data-id="' + cid + '"]');
    if (card) {
        var badge = card.querySelector(".proactive-badge");
        if (!badge) {
            badge = document.createElement("span");
            badge.className = "proactive-badge";
            badge.textContent = "💬";
            badge.title = "角色有新的主动消息";
            badge.style.cssText = "position:absolute;top:4px;right:4px;font-size:14px;animation:pulse 1s infinite;";
            card.style.position = "relative";
            card.appendChild(badge);
        }
    }
}

function hideProactiveBadge(cid) {
    var card = document.querySelector('.char-card[data-id="' + cid + '"]');
    if (card) {
        var badge = card.querySelector(".proactive-badge");
        if (badge) badge.remove();
    }
}

function syncProactiveUI() {
    var btn = document.getElementById("btnProactive");
    var bar = document.getElementById("proactiveBar");
    if (!btn || !bar) return;

    var cid = state.currentCharId;
    if (!cid) {
        btn.textContent = "💤 关";
        btn.style.borderColor = "";
        btn.style.color = "";
        btn.style.background = "";
        btn.title = "后台活跃：关闭";
        bar.style.display = "none";
        bar.style.background = "";
        return;
    }

    if (proactive.isEnabled(cid)) {
        btn.textContent = "💤 开";
        btn.style.borderColor = "#10b981";
        btn.style.color = "#10b981";
        btn.style.background = "rgba(16,185,129,0.15)";
        btn.title = "后台活跃：已开启";
        bar.style.display = "flex";
        bar.style.background = "#0a3a25";
        var slider = document.getElementById("proactiveSlider");
        var incVal = document.getElementById("proactiveIncrementVal");
        var probEl = document.getElementById("proactiveCurProb");
        if (slider) slider.value = proactive.increment;
        if (incVal) incVal.textContent = proactive.increment;
        if (probEl) {
            if (proactive.isWaiting(cid)) {
                probEl.textContent = "0";
            } else {
                var last = proactive.getLastActivity(cid);
                var mins = (Date.now() - last) / 60000;
                var prob = Math.round(Math.max(0, Math.min(3 + (mins - 1) * proactive.increment, 100)));
                probEl.textContent = prob;
            }
        }
    } else {
        btn.textContent = "💤 关";
        btn.style.borderColor = "";
        btn.style.color = "";
        btn.style.background = "";
        btn.title = "后台活跃：关闭";
        bar.style.display = "none";
        bar.style.background = "";
    }
}

function toggleProactive() {
    if (!state.currentCharId) {
        alert("请先选择一个角色");
        return;
    }

    var cid = state.currentCharId;
    var btn = document.getElementById("btnProactive");
    var bar = document.getElementById("proactiveBar");

    if (proactive.isEnabled(cid)) {
        // 关闭
        proactive.disable(cid);
        if (btn) {
            btn.textContent = "💤 关";
            btn.style.borderColor = "";
            btn.style.color = "";
            btn.style.background = "";
            btn.title = "后台活跃：关闭";
        }
        if (bar) bar.style.display = "none";
        alert("后台活跃：已关闭");
    } else {
        // 开启
        proactive.enable(cid);
        if (btn) {
            btn.textContent = "💤 开";
            btn.style.borderColor = "#10b981";
            btn.style.color = "#10b981";
            btn.style.background = "rgba(16,185,129,0.15)";
            btn.title = "后台活跃：已开启";
        }
        if (bar) {
            bar.style.display = "flex";
            bar.style.background = "#0a3a25";
            var slider = document.getElementById("proactiveSlider");
            var incVal = document.getElementById("proactiveIncrementVal");
            var probEl = document.getElementById("proactiveCurProb");
            if (slider) slider.value = proactive.increment;
            if (incVal) incVal.textContent = proactive.increment;
            if (probEl) probEl.textContent = "0";
        }
        alert("后台活跃：已开启！第1分钟为空白期，之后基础3%，每分钟+" + proactive.increment + "%");
    }
}
window.toggleProactive = toggleProactive;

function updateProactiveIncrement(val) {
    val = parseInt(val) || 5;
    proactive.increment = val;
    localStorage.setItem("proactiveIncrement", val);
    var el = document.getElementById("proactiveIncrementVal");
    if (el) el.textContent = val;
}
window.updateProactiveIncrement = updateProactiveIncrement;

// ========== DOM 引用 ==========
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
    characterList: $("#characterList"),
    chatMessages: $("#chatMessages"),
    chatHeader: $("#chatHeader"),
    chatAvatar: $("#chatAvatar"),
    chatName: $("#chatName"),
    chatInputArea: $("#chatInputArea"),
    msgInput: $("#msgInput"),
    welcomeScreen: $("#welcomeScreen"),
    searchResult: $("#searchResult"),
    btnDeleteChar: $("#btnDeleteChar"),
};

// ========== API 请求 ==========
async function api(method, url, body) {
    const opts = { method, headers: { "Content-Type": "application/json" } };
    if (body) opts.body = JSON.stringify(body);
    const resp = await fetch(url, opts);
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "请求失败");
    return data;
}

// ========== 角色列表 ==========
async function loadCharacters() {
    if (window.__INITIAL_CHARACTERS__ && window.__INITIAL_CHARACTERS__.length > 0) {
        state.characters = window.__INITIAL_CHARACTERS__;
        window.__INITIAL_CHARACTERS__ = null;
        renderCharacterList();
        return;
    }
    try {
        state.characters = await api("GET", "/api/characters");
    } catch (e) {
        console.error("加载角色失败:", e);
        state.characters = [];
    }
    renderCharacterList();
}

function renderCharacterList() {
    if (state.characters.length === 0) {
        dom.characterList.innerHTML =
            '<div style="text-align:center;color:var(--text-muted);padding:40px 20px;">还没有角色<br>点击 ＋ 创建第一个角色</div>';
        return;
    }
    dom.characterList.innerHTML = state.characters
        .map(
            (c) => {
                var hasBadge = proactive.isWaiting(c.id) && c.id !== state.currentCharId;
                return `
        <div class="char-card${c.id === state.currentCharId ? " active" : ""}" data-id="${c.id}" style="position:relative;">
            <div class="char-card-header">
                <span class="char-card-avatar">${renderAvatar(c.avatar, c.avatar_url, 40)}</span>
                <span class="char-card-name">${escHtml(c.name)}</span>
            </div>
            <div class="char-card-preview">${escHtml((c.personality || "").slice(0, 50))}...</div>
            <div class="char-card-meta">
                <span class="char-card-badge${c.source === "ai-search" ? " ai" : ""}">${c.source === "ai-search" ? "AI生成" : "手动"}</span>
                ${c.message_count ? `<span class="char-card-badge">${c.message_count} 条消息</span>` : ""}
            </div>
            ${hasBadge ? '<span class="proactive-badge" style="position:absolute;top:4px;right:4px;font-size:14px;animation:pulse 1s infinite;" title="角色有新的主动消息">💬</span>' : ""}
        </div>`;
            }
        )
        .join("");
}

function escHtml(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
}

function renderAvatar(avatar, avatarUrl, size) {
    if (avatarUrl) {
        return `<img src="${escHtml(avatarUrl)}" alt="" style="width:${size}px;height:${size}px;object-fit:cover;border-radius:50%;">`;
    }
    return escHtml(avatar || "🤖");
}

function getUserAvatar() {
    const url = localStorage.getItem("userAvatarUrl");
    const emoji = localStorage.getItem("userAvatarEmoji") || "👤";
    if (url) return `<img src="${escHtml(url)}" alt="" style="width:28px;height:28px;object-fit:cover;border-radius:50%;">`;
    return escHtml(emoji);
}

// ========== 对话 ==========
async function selectCharacter(cid) {
    state.currentCharId = cid;
    const char = state.characters.find((c) => c.id === cid);
    if (!char) return;

    // 清除该角色的通知标记
    hideProactiveBadge(cid);

    dom.chatAvatar.innerHTML = renderAvatar(char.avatar, char.avatar_url, 32);
    dom.chatName.textContent = char.name;
    dom.chatInputArea.style.display = "block";
    dom.welcomeScreen.style.display = "none";
    dom.msgInput.focus();

    localStorage.setItem("lastCharId", cid);
    renderCharacterList();
    loadChatHistory(cid);
    syncProactiveUI();
    showCharProfile(char);
}

async function loadChatHistory(cid) {
    try {
        const history = await api("GET", `/api/chat/${cid}/history`);
        renderMessages(history);
    } catch {
        renderMessages([]);
    }
}

function renderMessages(history) {
    dom.chatMessages.querySelectorAll(".message, .typing-indicator").forEach(el => el.remove());
    if (!history || history.length === 0) {
        dom.welcomeScreen.style.display = "";
        return;
    }
    dom.welcomeScreen.style.display = "none";
    history.forEach((msg) => {
        appendMessage(msg.role, msg.content);
    });
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
}

function appendMessage(role, content) {
    const div = document.createElement("div");
    div.className = `message ${role}`;
    const char = state.characters.find((c) => c.id === state.currentCharId);
    let avatarHtml;
    if (role === "user") {
        avatarHtml = getUserAvatar();
    } else if (char) {
        avatarHtml = renderAvatar(char.avatar, char.avatar_url, 28);
    } else {
        avatarHtml = "🤖";
    }
    div.innerHTML = `
        <span class="message-avatar">${avatarHtml}</span>
        <div>
            <div class="message-content">${escHtml(content)}</div>
        </div>`;
    dom.chatMessages.appendChild(div);
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
}

function addTypingIndicator() {
    const div = document.createElement("div");
    div.className = "message assistant";
    div.id = "typingIndicator";
    const char = state.characters.find((c) => c.id === state.currentCharId);
    const avatarHtml = char ? renderAvatar(char.avatar, char.avatar_url, 28) : "🤖";
    div.innerHTML = `
        <span class="message-avatar">${avatarHtml}</span>
        <div class="typing-indicator"><span></span><span></span><span></span></div>`;
    dom.chatMessages.appendChild(div);
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
}

function removeTypingIndicator() {
    const el = document.getElementById("typingIndicator");
    if (el) el.remove();
}

function appendSystemMessage(content) {
    const div = document.createElement("div");
    div.className = "message system";
    div.innerHTML = `
        <span class="message-avatar">⚡</span>
        <div>
            <div class="message-content system-msg">${content}</div>
        </div>`;
    dom.chatMessages.appendChild(div);
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
}

// ========== 斜杠命令系统 ==========
const COMMANDS = {
    help: { desc: "显示所有可用命令", usage: "/help" },
    clear: { desc: "清空当前对话", usage: "/clear" },
    reset: { desc: "重置当前对话（同 clear）", usage: "/reset" },
    list: { desc: "列出所有角色", usage: "/list" },
    switch: { desc: "切换到指定角色", usage: "/switch 角色名称" },
    whoami: { desc: "查看当前角色信息", usage: "/whoami" },
    model: { desc: "查看当前使用的模型", usage: "/model" },
    stats: { desc: "查看当前对话统计", usage: "/stats" },
    export: { desc: "导出当前对话记录", usage: "/export" },
    compact: { desc: "压缩当前对话上下文，节省 token", usage: "/compact" },
};

async function handleCommand(input) {
    const parts = input.slice(1).trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(" ");

    switch (cmd) {
        case "help":
        case "h":
        case "？": {
            let helpText = "<b>📋 可用命令列表</b><br><br>";
            for (const [name, info] of Object.entries(COMMANDS)) {
                helpText += `<b>/${name}</b> — ${info.desc}<br><span style="color:var(--text-muted);font-size:12px;">  ${info.usage}</span><br><br>`;
            }
            return helpText;
        }

        case "clear":
        case "reset":
        case "new": {
            if (!state.currentCharId) return "⚠️ 请先选择一个角色";
            clearChatSilent();
            return "✅ 对话已清空，可以开始新的话题了";
        }

        case "list":
        case "ls": {
            if (state.characters.length === 0) return "📭 还没有角色，点击 ＋ 创建第一个吧";
            let list = "<b>🎭 角色列表</b><br><br>";
            state.characters.forEach((c) => {
                const marker = c.id === state.currentCharId ? " 👈 当前" : "";
                list += `${c.avatar} <b>${escHtml(c.name)}</b>${marker}<br><span style="color:var(--text-muted);font-size:12px;">  ${escHtml((c.personality || "").slice(0, 60))}...</span><br><br>`;
            });
            return list;
        }

        case "switch":
        case "sw": {
            if (!args) return "⚠️ 用法：<b>/switch 角色名称</b><br>例如：/switch 初音未来";
            const target = state.characters.find(
                (c) => c.name.toLowerCase().includes(args.toLowerCase())
            );
            if (!target) return `❌ 找不到角色「${escHtml(args)}」，输入 <b>/list</b> 查看所有角色`;
            selectCharacter(target.id);
            loadCharToEditor(target.id);
            return `✅ 已切换到 ${target.avatar} <b>${escHtml(target.name)}</b>`;
        }

        case "whoami":
        case "who": {
            if (!state.currentCharId) return "⚠️ 请先选择一个角色";
            const char = state.characters.find((c) => c.id === state.currentCharId);
            if (!char) return "⚠️ 当前角色不存在";
            const source = char.source === "ai-search" ? "AI 搜索生成" : "手动创建";
            return `${char.avatar} <b>${escHtml(char.name)}</b><br><br>📝 性格描述：<br><span style="color:var(--text-secondary);">${escHtml(char.personality)}</span><br><br>🏷 来源：${source}<br>📅 创建时间：${new Date(char.created_at).toLocaleString()}`;
        }

        case "model":
        case "md":
            return "🤖 当前模型：<b>deepseek-chat</b><br>🔗 接口地址：<b>https://api.deepseek.com</b>";

        case "stats":
        case "st": {
            if (!state.currentCharId) return "⚠️ 请先选择一个角色";
            const char = state.characters.find((c) => c.id === state.currentCharId);
            if (!char) return "⚠️ 当前角色不存在";
            const msgCount = char.message_count || 0;
            return `📊 <b>${escHtml(char.name)}</b> 对话统计<br><br>💬 消息总数：<b>${msgCount} 条</b><br>📅 角色创建：${new Date(char.created_at).toLocaleDateString()}`;
        }

        case "compact":
        case "cmp": {
            if (!state.currentCharId) return "⚠️ 请先选择一个角色";
            try {
                const data = await api("POST", `/api/chat/${state.currentCharId}/compact`);
                return `✅ 上下文已压缩<br><br>📊 原始消息数：<b>${data.original_count} 条</b><br>📦 压缩后保留：<b>${data.compressed_count} 条</b><br>💾 节省约 <b>${data.tokens_saved}</b> tokens`;
            } catch (e) {
                return `❌ 压缩失败：${escHtml(e.message)}`;
            }
        }

        case "export":
        case "ex": {
            if (!state.currentCharId) return "⚠️ 请先选择一个角色";
            const char = state.characters.find((c) => c.id === state.currentCharId);
            if (!char) return "⚠️ 当前角色不存在";
            const history = dom.chatMessages.querySelectorAll(".message:not(.system)");
            if (history.length === 0) return "⚠️ 当前对话为空";
            let text = `对话记录 - ${char.name}\n导出时间：${new Date().toLocaleString()}\n${"=".repeat(40)}\n\n`;
            history.forEach((msg) => {
                const role = msg.classList.contains("user") ? "👤 你" : `${char.avatar} ${char.name}`;
                const content = msg.querySelector(".message-content").textContent;
                text += `${role}：\n${content}\n\n`;
            });
            const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `chat-${char.name}-${new Date().toISOString().slice(0, 10)}.txt`;
            a.click();
            return "✅ 对话已导出为文本文件";
        }

        default:
            return `❓ 未知命令「<b>/${escHtml(cmd)}</b>」<br>输入 <b>/help</b> 查看所有可用命令`;
    }
}

async function clearChatSilent() {
    if (!state.currentCharId) return;
    try { await api("DELETE", `/api/chat/${state.currentCharId}/history`); } catch (e) { /* ignore */ }
    renderMessages([]);
    loadCharacters();
}

async function sendMessage() {
    if (state.gameActive) {
        return sendGameMessage();
    }

    const msg = dom.msgInput.value.trim();
    if (!msg || !state.currentCharId) return;
    dom.msgInput.value = "";
    dom.msgInput.style.height = "auto";

    proactive.reset(state.currentCharId);

    appendMessage("user", msg);

    if (msg.startsWith("/")) {
        const result = await handleCommand(msg);
        appendSystemMessage(result);
        if (msg.startsWith("/clear") || msg.startsWith("/reset") || msg.startsWith("/switch") || msg.startsWith("/sw ")) {
            loadCharacters();
        }
        return;
    }

    addTypingIndicator();

    try {
        const data = await api("POST", "/api/chat", {
            character_id: state.currentCharId,
            message: msg,
            web_search: state.webSearchEnabled,
        });
        removeTypingIndicator();
        appendMessage("assistant", data.reply);
        if (data.web_searched) {
            const label = data.search_source === "web"
                ? "🌐 此回复参考了 Bing 实时搜索结果"
                : "🤖 此回复参考了 AI 知识库信息";
            appendSystemMessage(label);
        }
    } catch (e) {
        removeTypingIndicator();
        appendMessage("assistant", "❌ 错误: " + e.message);
    }

    loadCharacters();
}

async function clearChat() {
    if (!state.currentCharId) return;
    if (!confirm("确定要清空当前对话记录吗？")) return;
    await api("DELETE", `/api/chat/${state.currentCharId}/history`);
    renderMessages([]);
    loadCharacters();
}

// ========== 角色编辑 ==========
function showCharProfile(char) {
    document.getElementById("charProfile").style.display = "block";
    document.getElementById("editFormSections").style.display = "none";
    document.getElementById("charProfileAvatar").innerHTML = renderAvatar(char.avatar, char.avatar_url, 80);
    document.getElementById("charProfileName").textContent = char.name;
    document.getElementById("charProfileDesc").textContent = (char.personality || "").slice(0, 150);
}

function showEditForm() {
    document.getElementById("charProfile").style.display = "none";
    document.getElementById("editFormSections").style.display = "";
}

function resetEditForm() {
    state.editingCharId = null;
    state.searchResult = null;
    $("#editName").value = "";
    $("#editPersonality").value = "";
    $("#editAvatar").value = "🤖";
    $("#editAvatarUrl").value = "";
    $("#charAvatarPreview").innerHTML = "🤖";
    $("#searchName").value = "";
    dom.searchResult.style.display = "none";
    dom.btnDeleteChar.style.display = "none";
    showEditForm();
}

function loadCharToEditor(cid) {
    const char = state.characters.find((c) => c.id === cid);
    if (!char) return;
    state.editingCharId = cid;
    $("#editName").value = char.name;
    $("#editPersonality").value = char.personality;
    $("#editAvatar").value = char.avatar || "🤖";
    $("#editAvatarUrl").value = char.avatar_url || "";
    $("#charAvatarPreview").innerHTML = renderAvatar(char.avatar, char.avatar_url, 48);
    dom.searchResult.style.display = "none";
    dom.btnDeleteChar.style.display = "inline-flex";
    showEditForm();
    document.getElementById("charProfile").style.display = "none";
    document.getElementById("editFormSections").style.display = "";
}

async function saveCharacter(source = "manual", silent = false) {
    const name = $("#editName").value.trim();
    const personality = $("#editPersonality").value.trim();
    const avatar = $("#editAvatar").value.trim() || "🤖";
    if (!name || !personality) {
        if (!silent) alert("请填写角色名称和性格描述");
        return null;
    }

    const avatarUrl = $("#editAvatarUrl").value.trim();
    const body = { name, personality, avatar };
    if (avatarUrl) body.avatar_url = avatarUrl;
    let savedChar = null;

    if (state.editingCharId) {
        await api("PUT", `/api/characters/${state.editingCharId}`, body);
        savedChar = state.characters.find((c) => c.id === state.editingCharId) || { id: state.editingCharId, ...body };
    } else {
        body.source = source;
        savedChar = await api("POST", "/api/characters", body);
        state.editingCharId = savedChar.id;
    }

    await loadCharacters();
    if (savedChar && savedChar.id) {
        selectCharacter(savedChar.id);
    }
    resetEditForm();
    if (!silent) alert("角色已保存！");
    return savedChar;
}

async function deleteCharacter() {
    if (!state.editingCharId) return;
    if (!confirm("确定要删除这个角色吗？对话记录也将被清除。")) return;
    await api("DELETE", `/api/characters/${state.editingCharId}`);
    proactive.disable(state.editingCharId);
    if (state.currentCharId === state.editingCharId) {
        state.currentCharId = null;
        dom.chatInputArea.style.display = "none";
        dom.chatMessages.querySelectorAll(".message, .typing-indicator").forEach(el => el.remove());
        dom.welcomeScreen.style.display = "";
        dom.chatAvatar.textContent = "💬";
        dom.chatName.textContent = "选择角色开始对话";
    }
    resetEditForm();
    await loadCharacters();
}

// ========== AI 搜索角色 ==========
async function searchCharacter() {
    const name = $("#searchName").value.trim();
    if (!name) { alert("请输入人物名称"); return; }

    dom.searchResult.style.display = "block";
    dom.searchResult.innerHTML = '<div style="text-align:center;padding:20px;"><span class="spinner"></span> AI 正在搜索...</div>';

    try {
        const data = await api("POST", "/api/search-character", { name });
        state.searchResult = null;
        const candidates = data.candidates || [];

        if (candidates.length === 0) {
            dom.searchResult.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;">未找到匹配角色，请尝试其他关键词</div>';
            return;
        }

        dom.searchResult.innerHTML = `
            <div style="font-size:13px;color:var(--text-muted);margin-bottom:10px;">找到 <b>${candidates.length}</b> 个相关角色，点击选择：</div>
            <div class="candidate-list">
                ${candidates.map((c, i) => `
                    <div class="candidate-card" onclick="selectSearchCandidate('${escHtml(c.name || '未知').replace(/'/g, "\\'")}')" style="animation-delay:${i * 0.05}s">
                        <span class="candidate-emoji">${escHtml(c.emoji || '🌟')}</span>
                        <div class="candidate-info">
                            <span class="candidate-name">${i + 1}. ${escHtml(c.name || '未知')}</span>
                            <span class="candidate-brief">${escHtml(c.brief || '暂无简介')}</span>
                        </div>
                        <span class="candidate-arrow">→</span>
                    </div>
                `).join("")}
            </div>
            <button class="btn btn-outline btn-sm" style="margin-top:10px;width:100%;" onclick="cancelSearchResult()">取消</button>`;
    } catch (e) {
        dom.searchResult.innerHTML = `<div style="color:var(--danger);text-align:center;">❌ ${escHtml(e.message)}</div>`;
    }
}

async function selectSearchCandidate(name) {
    dom.searchResult.style.display = "block";
    dom.searchResult.innerHTML = '<div style="text-align:center;padding:20px;"><span class="spinner"></span> 正在生成角色设定...</div>';

    try {
        const data = await api("POST", "/api/search-character/detail", { name });
        state.searchResult = data;
        dom.searchResult.innerHTML = `
            <div class="search-result-header">
                <span class="search-result-avatar">${data.avatar}</span>
                <span class="search-result-name">${escHtml(data.name)}</span>
            </div>
            <div class="search-result-desc">${escHtml(data.personality)}</div>
            <div class="search-result-actions">
                <button class="btn btn-primary btn-sm" onclick="applySearchResult()">✅ 应用此角色</button>
                <button class="btn btn-outline btn-sm" onclick="searchCharacter()">↩ 返回列表</button>
            </div>`;
    } catch (e) {
        dom.searchResult.innerHTML = `<div style="color:var(--danger);text-align:center;">❌ ${escHtml(e.message)}</div>`;
    }
}

function applySearchResult() {
    if (!state.searchResult) return;
    $("#editName").value = state.searchResult.name;
    $("#editPersonality").value = state.searchResult.personality;
    $("#editAvatar").value = state.searchResult.avatar;
    dom.searchResult.style.display = "none";
    state.searchResult = null;
    saveCharacter("ai-search", true);
}

function cancelSearchResult() {
    dom.searchResult.style.display = "none";
    state.searchResult = null;
}

// ========== 头像上传 ==========
async function uploadCharAvatar() {
    const file = document.getElementById("charAvatarFile").files[0];
    if (!file) return;
    const url = await uploadAvatarFile(file);
    if (url) {
        $("#editAvatarUrl").value = url;
        $("#editAvatar").value = "";
        $("#charAvatarPreview").innerHTML = `<img src="${escHtml(url)}" alt="">`;
    }
}

async function uploadUserAvatar() {
    const file = document.getElementById("userAvatarFile").files[0];
    if (!file) return;
    const url = await uploadAvatarFile(file);
    if (url) {
        localStorage.setItem("userAvatarUrl", url);
        document.getElementById("userAvatarPreview").innerHTML = `<img src="${escHtml(url)}" alt="">`;
    }
}

function resetUserAvatar() {
    localStorage.removeItem("userAvatarUrl");
    document.getElementById("userAvatarPreview").textContent = "👤";
}

async function uploadAvatarFile(file) {
    if (file.size > 2 * 1024 * 1024) {
        alert("图片大小不能超过 2MB");
        return null;
    }
    const formData = new FormData();
    formData.append("file", file);
    try {
        const resp = await fetch("/api/upload-avatar", { method: "POST", body: formData });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error);
        return data.url;
    } catch (e) {
        alert("上传失败: " + e.message);
        return null;
    }
}

// ========== 设置 ==========
async function loadSettings() {
    const config = await api("GET", "/api/config");
    if (config.has_api_key) {
        $("#settingApiKey").placeholder = "已设置 (留空不修改)";
    }
}

async function saveSettings() {
    const body = {};
    const apiKey = $("#settingApiKey").value.trim();
    if (apiKey) body.api_key = apiKey;
    await api("POST", "/api/config", body);
    $("#settingApiKey").value = "";
    $("#settingApiKey").placeholder = "已设置 (留空不修改)";
    alert("设置已保存！");
}

// ========== 事件绑定 ==========
dom.characterList.addEventListener("click", (e) => {
    const card = e.target.closest(".char-card");
    if (!card) return;
    selectCharacter(card.dataset.id);
    loadCharToEditor(card.dataset.id);
});

$("#btnRefreshChars").addEventListener("click", async () => {
    const btn = $("#btnRefreshChars");
    btn.textContent = "⏳";
    btn.disabled = true;
    try {
        window.__INITIAL_CHARACTERS__ = null;
        state.characters = await api("GET", "/api/characters");
    } catch (e) {
        console.error("刷新失败:", e);
    }
    renderCharacterList();
    btn.textContent = "🔄";
    btn.disabled = false;
});

$("#btnNewChar").addEventListener("click", () => {
    resetEditForm();
    state.currentCharId = null;
    dom.chatInputArea.style.display = "none";
    dom.chatMessages.querySelectorAll(".message, .typing-indicator").forEach(el => el.remove());
    dom.welcomeScreen.style.display = "";
    dom.chatAvatar.textContent = "💬";
    dom.chatName.textContent = "选择角色开始对话";
    renderCharacterList();
});

$("#btnSend").addEventListener("click", sendMessage);
dom.msgInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});
dom.msgInput.addEventListener("input", () => {
    dom.msgInput.style.height = "auto";
    dom.msgInput.style.height = Math.min(dom.msgInput.scrollHeight, 120) + "px";
});

$("#btnClearChat").addEventListener("click", clearChat);
$("#btnSaveChar").addEventListener("click", () => saveCharacter("manual"));
$("#btnDeleteChar").addEventListener("click", deleteCharacter);
$("#btnSearch").addEventListener("click", searchCharacter);
$("#btnEditChar").addEventListener("click", showEditForm);
var btnProactive = $("#btnProactive");
if (btnProactive) btnProactive.addEventListener("click", toggleProactive);
$("#searchName").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); searchCharacter(); }
});

document.addEventListener("click", (e) => {
    const applyBtn = e.target.closest("#btnApplySearch");
    const cancelBtn = e.target.closest("#btnCancelSearch");
    if (applyBtn) applySearchResult();
    if (cancelBtn) cancelSearchResult();
});

var btnGameStart = document.getElementById("btnGameStart");
if (btnGameStart) btnGameStart.addEventListener("click", startGame);
var btnGameEnd = document.getElementById("btnGameEnd");
if (btnGameEnd) btnGameEnd.addEventListener("click", endGame);

function toggleWebSearch() {
    state.webSearchEnabled = !state.webSearchEnabled;
    const btn = $("#btnWebSearch");
    if (state.webSearchEnabled) {
        btn.textContent = "🌐✓";
        btn.style.borderColor = "var(--success)";
        btn.style.color = "var(--success)";
        btn.title = "联网搜索已开启";
    } else {
        btn.textContent = "🌐";
        btn.style.borderColor = "";
        btn.style.color = "";
        btn.title = "切换联网搜索";
    }
}

// ========== 海龟汤游戏 ==========
function syncGameUI() {
    var startBtn = document.getElementById("btnGameStart");
    var endBtn = document.getElementById("btnGameEnd");
    var banner = document.getElementById("gameBanner");
    var input = document.getElementById("chatInputArea");
    var msgInput = document.getElementById("msgInput");
    var welcome = document.getElementById("welcomeScreen");

    if (state.gameActive) {
        if (startBtn) { startBtn.classList.add("active"); startBtn.textContent = "🎭 游戏中"; }
        if (endBtn) endBtn.style.display = "";
        if (banner) banner.style.display = "flex";
        if (input) input.style.display = "block";
        if (welcome) welcome.style.display = "none";
        if (msgInput) msgInput.placeholder = "输入你的问题或猜测...";

        if (!state.currentCharId) {
            if (!state._prevChatName) {
                state._prevChatName = dom.chatName.textContent;
                state._prevChatAvatar = dom.chatAvatar.innerHTML;
            }
            dom.chatName.textContent = "海龟汤游戏";
            dom.chatAvatar.innerHTML = "🎭";
        }
    } else {
        if (startBtn) { startBtn.classList.remove("active"); startBtn.textContent = "🎭 海龟汤"; }
        if (endBtn) endBtn.style.display = "none";
        if (banner) banner.style.display = "none";
        if (msgInput) msgInput.placeholder = "输入消息，Enter 发送...  输入 /help 查看命令";

        if (!state.currentCharId) {
            if (state._prevChatName) {
                dom.chatName.textContent = state._prevChatName;
                dom.chatAvatar.innerHTML = state._prevChatAvatar;
                state._prevChatName = null;
                state._prevChatAvatar = null;
            }
            if (input) input.style.display = "none";
            if (welcome) welcome.style.display = "";
        }
    }
}

function appendGameMessage(role, content) {
    var div = document.createElement("div");
    div.className = "message game-" + role;
    var avatarHtml;
    if (role === "user") {
        avatarHtml = getUserAvatar();
    } else {
        var char = state.characters.find(function(c) { return c.id === state.currentCharId; });
        avatarHtml = char ? renderAvatar(char.avatar, char.avatar_url, 28) : "🎭";
    }
    div.innerHTML =
        '<span class="message-avatar">' + avatarHtml + '</span>' +
        '<div>' +
            '<div class="message-content">' + escHtml(content) + '</div>' +
        '</div>';
    dom.chatMessages.appendChild(div);
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
}

async function startGame() {
    addTypingIndicator();

    try {
        var body = {};
        if (state.currentCharId) body.character_id = state.currentCharId;
        var data = await api("POST", "/api/game/start", body);
        removeTypingIndicator();
        appendGameMessage("assistant", data.reply);
        state.gameActive = true;
        syncGameUI();
    } catch (e) {
        removeTypingIndicator();
        appendSystemMessage("🎭 主持人暂时离线，请稍后再来破案🔍");
    }
}

async function endGame() {
    try {
        await api("POST", "/api/game/end");
    } catch (e) { /* ignore */ }
    state.gameActive = false;
    syncGameUI();
    appendSystemMessage("🎭 海龟汤游戏已结束，欢迎再来破案！");
}

async function sendGameMessage() {
    var msg = dom.msgInput.value.trim();
    if (!msg) return;
    dom.msgInput.value = "";
    dom.msgInput.style.height = "auto";

    appendGameMessage("user", msg);
    addTypingIndicator();

    try {
        var data = await api("POST", "/api/game/guess", { message: msg });
        removeTypingIndicator();
        appendGameMessage("assistant", data.reply);
    } catch (e) {
        removeTypingIndicator();
        appendSystemMessage("🎭 主持人暂时离线，请稍后再来破案🔍");
    }
}

function switchTab(tabName) {
    $$(".panel-tab").forEach((t) => t.classList.remove("active"));
    $$(".panel-content").forEach((p) => p.classList.remove("active"));

    const tabEl = document.querySelector(`.panel-tab[data-tab="${tabName}"]`);
    if (tabEl) tabEl.classList.add("active");

    const panelId = tabName === "edit" ? "panelEdit" : "panelSettings";
    const panelEl = document.getElementById(panelId);
    if (panelEl) panelEl.classList.add("active");

    if (tabName === "settings") loadSettings();
}

// Emoji 建议
const commonEmojis = ["🤖","😊","🧙","🌸","😈","🎭","🦸","👑","🎯","🔥","💡","🌟","🐱","🦊","🎨","💪","🧠","🎵","📚","⚡"];
const emojiContainer = $("#emojiSuggestions");
commonEmojis.forEach((emoji) => {
    const span = document.createElement("span");
    span.className = "emoji-suggestion";
    span.textContent = emoji;
    span.addEventListener("click", () => { $("#editAvatar").value = emoji; });
    emojiContainer.appendChild(span);
});

// ========== 初始化 ==========
(async function init() {
    const userAvatarUrl = localStorage.getItem("userAvatarUrl");
    if (userAvatarUrl) {
        document.getElementById("userAvatarPreview").innerHTML = `<img src="${escHtml(userAvatarUrl)}" alt="">`;
    }

    var savedIncrement = localStorage.getItem("proactiveIncrement");
    if (savedIncrement) {
        proactive.increment = parseInt(savedIncrement) || 5;
        var slider = document.getElementById("proactiveSlider");
        if (slider) slider.value = proactive.increment;
        var incVal = document.getElementById("proactiveIncrementVal");
        if (incVal) incVal.textContent = proactive.increment;
    }

    try {
        await loadCharacters();

        for (let i = 0; i < 8 && state.characters.length === 0; i++) {
            window.__INITIAL_CHARACTERS__ = null;
            try {
                state.characters = await api("GET", "/api/characters");
                renderCharacterList();
            } catch (e) { /* 继续重试 */ }
            if (state.characters.length > 0) break;
            await new Promise(r => setTimeout(r, 1000));
        }

        if (state.characters.length === 0) return;

        // 为所有已启用后台活跃的角色启动定时器
        proactive.initAll();

        const lastId = localStorage.getItem("lastCharId");
        const target = (lastId && state.characters.find((c) => c.id === lastId))
            ? state.characters.find((c) => c.id === lastId)
            : state.characters[0];
        if (target) {
            selectCharacter(target.id);
            loadCharToEditor(target.id);
        }
        refreshCharactersSilent();
    } catch (e) {
        console.error("初始化失败:", e);
        dom.characterList.innerHTML =
            '<div style="text-align:center;color:var(--danger);padding:40px 20px;">加载失败，请确认服务已启动</div>';
    }
})();

async function refreshCharactersSilent() {
    try {
        window.__INITIAL_CHARACTERS__ = null;
        const fresh = await api("GET", "/api/characters");
        const curId = state.currentCharId;
        state.characters = fresh;
        if (curId && !state.characters.find((c) => c.id === curId)) {
            state.currentCharId = null;
            dom.chatInputArea.style.display = "none";
            dom.welcomeScreen.style.display = "";
            dom.chatAvatar.textContent = "💬";
            dom.chatName.textContent = "选择角色开始对话";
        }
        renderCharacterList();
    } catch (e) {
        // 静默失败
    }
}
