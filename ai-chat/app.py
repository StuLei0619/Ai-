import json
import os
import re
import uuid
import base64
import requests
from datetime import datetime
from flask import Flask, render_template, request, jsonify, send_from_directory

app = Flask(__name__)

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")
CHARACTERS_FILE = os.path.join(DATA_DIR, "characters.json")
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "uploads")

# 固定 DeepSeek 配置，不会因前端操作而改变
AI_API_BASE = "https://api.deepseek.com"
AI_MODEL = "deepseek-chat"


def load_json(path, default=None):
    if default is None:
        default = {}
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def load_config():
    config = load_json(CONFIG_FILE, {"api_key": ""})
    config["api_base"] = AI_API_BASE
    config["model"] = AI_MODEL
    return config


def load_characters():
    return load_json(CHARACTERS_FILE, {"characters": [], "chats": {}})


def call_ai(messages, config=None):
    if config is None:
        config = load_config()
    headers = {
        "Authorization": f"Bearer {config['api_key']}",
        "Content-Type": "application/json",
    }
    body = {
        "model": config["model"],
        "messages": messages,
        "temperature": 0.8,
        "max_tokens": 1024,
    }
    resp = requests.post(
        f"{config['api_base'].rstrip('/')}/v1/chat/completions",
        headers=headers,
        json=body,
        timeout=60,
    )
    if resp.status_code != 200:
        try:
            err = resp.json()
            err_msg = err.get("error", {}).get("message", resp.text[:300])
        except Exception:
            err_msg = resp.text[:300]
        raise Exception(f"API 错误 [{resp.status_code}]: {err_msg}")
    return resp.json()["choices"][0]["message"]["content"]


def search_web(query, max_results=3):
    """使用 Bing 搜索网页，返回摘要列表（可能因验证码失败）"""
    try:
        url = "https://www.bing.com/search"
        resp = requests.get(
            url,
            params={"q": query, "setlang": "zh-cn"},
            timeout=8,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
                "Accept-Language": "zh-CN,zh;q=0.9",
            },
        )
        # 检测是否被拦截
        if "captcha" in resp.text.lower() or len(resp.text) < 1000:
            return []
        blocks = re.findall(
            r'<li class="b_algo"[^>]*>(.*?)</li>',
            resp.text, re.DOTALL
        )
        results = []
        for block in blocks[:max_results]:
            clean = re.sub(r'<[^>]+>', '', block).strip()
            clean = re.sub(r'\s+', ' ', clean)[:300]
            if clean:
                results.append(clean)
        return results
    except Exception:
        return []


def search_web_or_ai(query, config, max_results=3):
    """优先 Bing 搜索，失败则让 AI 提供知识库信息"""
    web_results = search_web(query, max_results)
    if web_results:
        return web_results, "web"

    # 回退：AI 知识库（对热门人物/话题效果好）
    try:
        prompt = (
            f"请就「{query}」这个话题，提供3条最关键的公开百科信息。"
            f"每条控制在50字以内，基于可查证的事实。直接输出3行纯文本，不要编号，不要前缀。"
        )
        ai_result = call_ai(
            [{"role": "user", "content": prompt}],
            config,
        )
        lines = [l.strip() for l in ai_result.strip().split("\n") if l.strip()]
        return lines[:max_results], "ai"
    except Exception:
        return [], "none"


@app.after_request
def add_header(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


@app.route("/")
def index():
    data = load_characters()
    chars = data.get("characters", [])
    chats = data.get("chats", {})
    # 为每个角色附上消息数
    for c in chars:
        c["message_count"] = len(chats.get(c["id"], []))
    return render_template("index.html",
        characters_json=json.dumps(chars, ensure_ascii=False),
        total_chars=len(chars))


@app.route("/api/config", methods=["GET", "POST"])
def api_config():
    if request.method == "GET":
        config = load_config()
        config.pop("api_key", None)
        has_key = bool(load_json(CONFIG_FILE, {}).get("api_key"))
        config["has_api_key"] = has_key
        return jsonify(config)
    else:
        data = request.get_json()
        config = load_json(CONFIG_FILE, {"api_key": ""})
        if "api_key" in data and data["api_key"]:
            config["api_key"] = data["api_key"]
        save_json(CONFIG_FILE, config)
        return jsonify({"ok": True})


@app.route("/api/upload-avatar", methods=["POST"])
def api_upload_avatar():
    """上传头像图片，返回访问 URL"""
    file = request.files.get("file")
    if not file:
        return jsonify({"error": "未选择文件"}), 400

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in (".png", ".jpg", ".jpeg", ".gif", ".webp"):
        return jsonify({"error": "仅支持 PNG/JPG/GIF/WebP 格式"}), 400

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    filename = f"avatar_{uuid.uuid4().hex[:8]}{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)
    file.save(filepath)

    url = f"/static/uploads/{filename}"
    return jsonify({"url": url, "filename": filename})


@app.route("/static/uploads/<path:filename>")
def serve_upload(filename):
    return send_from_directory(UPLOAD_DIR, filename)


@app.route("/api/characters", methods=["GET", "POST"])
def api_characters():
    data = load_characters()
    if request.method == "GET":
        chars = data.get("characters", [])
        for c in chars:
            cid = c["id"]
            chat_count = len(data.get("chats", {}).get(cid, []))
            c["message_count"] = chat_count
        return jsonify(chars)
    else:
        body = request.get_json()
        char = {
            "id": str(uuid.uuid4())[:8],
            "name": body.get("name", "未命名"),
            "personality": body.get("personality", ""),
            "avatar": body.get("avatar", "🤖"),
            "avatar_url": body.get("avatar_url", ""),
            "created_at": datetime.now().isoformat(),
            "source": body.get("source", "manual"),
        }
        data.setdefault("characters", []).append(char)
        save_json(CHARACTERS_FILE, data)
        return jsonify(char)


@app.route("/api/characters/<cid>", methods=["PUT", "DELETE"])
def api_character(cid):
    data = load_characters()
    if request.method == "PUT":
        body = request.get_json()
        for c in data.get("characters", []):
            if c["id"] == cid:
                if "name" in body:
                    c["name"] = body["name"]
                if "personality" in body:
                    c["personality"] = body["personality"]
                if "avatar" in body:
                    c["avatar"] = body["avatar"]
                if "avatar_url" in body:
                    c["avatar_url"] = body["avatar_url"]
                break
        save_json(CHARACTERS_FILE, data)
        return jsonify({"ok": True})
    else:
        data["characters"] = [c for c in data.get("characters", []) if c["id"] != cid]
        data.get("chats", {}).pop(cid, None)
        save_json(CHARACTERS_FILE, data)
        return jsonify({"ok": True})


@app.route("/api/chat", methods=["POST"])
def api_chat():
    body = request.get_json()
    cid = body.get("character_id")
    user_msg = body.get("message", "").strip()
    web_search = body.get("web_search", False)
    if not cid or not user_msg:
        return jsonify({"error": "缺少参数"}), 400

    data = load_characters()
    char = next((c for c in data.get("characters", []) if c["id"] == cid), None)
    if not char:
        return jsonify({"error": "角色不存在"}), 404

    config = load_config()
    if not config.get("api_key"):
        return jsonify({"error": "请先在设置中配置 API Key"}), 400

    history = data.get("chats", {}).get(cid, [])
    messages = [{"role": "system", "content": char["personality"]}]

    # 联网搜索：将搜索结果注入上下文
    search_info = None
    search_source = None
    if web_search:
        search_query = f"{char['name']} {user_msg}"
        search_results, search_source = search_web_or_ai(search_query, config, max_results=3)
        if search_results:
            search_info = "\n".join(f"{i}. {r}" for i, r in enumerate(search_results, 1))
            source_label = "实时网络搜索" if search_source == "web" else "AI 知识库"
            context = (
                f"以下是关于「{search_query}」的{source_label}结果，请参考这些信息来丰富你的回复"
                "（如果搜索结果与话题无关，可忽略）：\n\n"
                f"{search_info}\n\n"
                "请结合以上信息，用角色的语气和风格来回复用户。"
            )
            messages.append({"role": "system", "content": context})

    messages += history[-20:]
    messages.append({"role": "user", "content": user_msg})

    try:
        reply = call_ai(messages, config)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    data.setdefault("chats", {}).setdefault(cid, [])
    data["chats"][cid].append({"role": "user", "content": user_msg})
    data["chats"][cid].append({"role": "assistant", "content": reply})
    save_json(CHARACTERS_FILE, data)

    return jsonify({
        "reply": reply,
        "web_searched": bool(search_info),
        "search_source": search_source,
    })


@app.route("/api/chat/<cid>/history", methods=["GET"])
def api_chat_history(cid):
    data = load_characters()
    return jsonify(data.get("chats", {}).get(cid, []))


@app.route("/api/chat/<cid>/history", methods=["DELETE"])
def api_chat_clear(cid):
    data = load_characters()
    data.get("chats", {}).pop(cid, None)
    save_json(CHARACTERS_FILE, data)
    return jsonify({"ok": True})


@app.route("/api/chat/<cid>/proactive", methods=["POST"])
def api_chat_proactive(cid):
    data = load_characters()
    char = next((c for c in data.get("characters", []) if c["id"] == cid), None)
    if not char:
        return jsonify({"error": "角色不存在"}), 404

    config = load_config()
    if not config.get("api_key"):
        return jsonify({"error": "请先配置 API Key"}), 400

    messages = [{"role": "system", "content": char["personality"]}]

    proactive_prompt = (
        "现在请你主动联系用户，就像朋友之间突然想到对方、随手发了个消息。"
        "不要参考之前的任何对话，完全重新开启一个话题。"
        "你可以：1）分享一件你正在做或刚发生的日常小事；2）聊一段你自己的往事、经历或回忆；"
        "3）对用户嘘寒问暖，问问对方在干嘛、今天过得怎么样、吃了吗之类的关心话。"
        "语气要自然随意，用你的角色语气和风格来说。"
        "消息控制在2-4句话。"
    )
    messages.append({"role": "system", "content": proactive_prompt})

    try:
        reply = call_ai(messages, config)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    data.setdefault("chats", {}).setdefault(cid, [])
    data["chats"][cid].append({"role": "assistant", "content": reply})
    save_json(CHARACTERS_FILE, data)

    return jsonify({"reply": reply})


@app.route("/api/chat/<cid>/compact", methods=["POST"])
def api_chat_compact(cid):
    data = load_characters()
    history = data.get("chats", {}).get(cid, [])
    if not history:
        return jsonify({"error": "当前对话为空，无需压缩"}), 400

    config = load_config()
    if not config.get("api_key"):
        return jsonify({"error": "请先在设置中配置 API Key"}), 400

    original_count = len(history)

    # 构建用于总结的对话文本
    convo_text = ""
    for msg in history:
        role_label = "用户" if msg["role"] == "user" else "AI"
        convo_text += f"{role_label}：{msg['content']}\n"

    prompt = f"""请将以下对话内容压缩为一段简洁的摘要（200字以内），保留关键信息和上下文脉络，以便后续对话能延续之前的话题：

{convo_text}

请用中文输出摘要，直接给出摘要内容，不要加前缀或后缀。"""

    try:
        summary = call_ai(
            [{"role": "user", "content": prompt}],
            config,
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    # 保留最后 4 条消息 + 摘要
    recent = history[-4:] if len(history) >= 4 else history
    compressed = [
        {"role": "system", "content": f"[上下文摘要] {summary}"}
    ] + recent

    data["chats"][cid] = compressed
    save_json(CHARACTERS_FILE, data)

    tokens_saved = max(0, (original_count - len(compressed)) * 150)

    return jsonify({
        "ok": True,
        "original_count": original_count,
        "compressed_count": len(compressed),
        "tokens_saved": tokens_saved,
    })


@app.route("/api/search-character", methods=["POST"])
def api_search_character():
    body = request.get_json()
    name = body.get("name", "").strip()
    if not name:
        return jsonify({"error": "请输入人名"}), 400

    config = load_config()
    if not config.get("api_key"):
        return jsonify({"error": "请先在设置中配置 API Key"}), 400

    prompt = f'''搜索关键词：「{name}」。请找出与此名称最相关的公开知名人物/角色（真实或虚拟），按知名度从高到低排列，最多 5 个。

要求：
- 只返回你确定存在的、有广泛知名度的人物/角色，不要编造
- brief 需包含具体的身份标签（如"日本虚拟歌姬"而非"一个角色"）
- emoji 需与人物高度相关

严格返回 JSON 数组（不要 markdown 代码块）：
[
  {{"name": "准确全名", "brief": "具体身份+代表作（20字内）", "emoji": "贴切emoji"}}
]

如果搜索词模糊（如"科比"），可列出多个可能的匹配。精确匹配返回1个。无匹配返回 []。'''

    messages = [
        {"role": "system", "content": "你是一个角色搜索助手，严格基于公开信息返回真实存在的热门角色。只返回你确定存在的人物，不编造。始终返回合法 JSON 数组。"},
        {"role": "user", "content": prompt},
    ]

    try:
        result = call_ai(messages, config)
        result = result.strip()

        # 用正则提取 JSON 数组（健壮处理 AI 返回的各种格式）
        match = re.search(r'\[.*\]', result, re.DOTALL)
        if not match:
            candidates = []
        else:
            json_str = match.group(0)
            candidates = json.loads(json_str)
            if not isinstance(candidates, list):
                candidates = []
            # 字符串数组 → 对象数组
            normalized = []
            for c in candidates:
                if isinstance(c, str):
                    normalized.append({"name": c, "brief": "", "emoji": "🌟"})
                elif isinstance(c, dict):
                    c.setdefault("name", c.pop("character_name", c.pop("full_name", c.pop("n", "未知"))))
                    c.setdefault("brief", c.pop("description", c.pop("desc", c.pop("b", ""))))
                    c.setdefault("emoji", c.pop("icon", c.pop("e", "🌟")))
                    normalized.append(c)
            candidates = normalized

    except Exception as e:
        return jsonify({"error": f"搜索解析失败：{str(e)}"}), 500

    return jsonify({"candidates": candidates, "query": name})


@app.route("/api/search-character/detail", methods=["POST"])
def api_search_character_detail():
    body = request.get_json()
    name = body.get("name", "").strip()
    if not name:
        return jsonify({"error": "请输入人名"}), 400

    config = load_config()
    if not config.get("api_key"):
        return jsonify({"error": "请先在设置中配置 API Key"}), 400

    prompt = f'''请根据「{name}」的真实公开信息，为其生成一段精确的角色扮演 system prompt。要求：

1. 基本身份：全名、国籍/出身、职业/定位、代表作品或成就
2. 核心性格：基于真实访谈、作品或公开言行提炼 4-6 个关键词
3. 说话风格：尽量贴近真实语气，引用其标志性口癖、惯用语或经典语录风格
4. 行为模式：基于真实事迹或公认设定，描述典型反应

重要：所有描述必须基于可查证的公开信息，不得编造。如信息不足，宁可简短也不要杜撰。

请用中文描述，以"你是{name}"开头，150-300字。这段 prompt 将用于角色扮演对话。'''

    messages = [
        {"role": "system", "content": "你是一个专业的角色设定师，严格基于真实公开信息生成角色描述，绝不编造。"},
        {"role": "user", "content": prompt},
    ]

    try:
        result = call_ai(messages, config)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    avatar_prompt = f'请为「{name}」选择一个最贴切的单个 emoji 表情符号，只回复这个 emoji，不要其他任何内容。'
    try:
        avatar = call_ai(
            [{"role": "user", "content": avatar_prompt}],
            config,
        ).strip()
    except Exception:
        avatar = "🌟"

    return jsonify({"name": name, "personality": result, "avatar": avatar, "source": "ai-search"})


if __name__ == "__main__":
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    app.run(debug=True, host="0.0.0.0", port=5000)
