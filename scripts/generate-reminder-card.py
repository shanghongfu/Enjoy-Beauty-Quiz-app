#!/usr/bin/env python3
"""Generate a reminder card (memory card) image for Supabase data retention."""
from PIL import Image, ImageDraw, ImageFont

W, H = 1080, 1620
OUT = "/Users/ak/WorkBuddy/2026-08-25-13-22-56/quiz-app/Supabase-数据保存提醒卡.png"

# Theme colors (Enjoy Beauty brand)
PINK = (255, 107, 157)        # #FF6B9D
PINK_DEEP = (224, 68, 122)    # deeper pink
GOLD = (201, 168, 106)        # #C9A86A
BG = (255, 247, 250)          # light pink-white
CARD = (255, 255, 255)
INK = (52, 42, 48)            # near-black text
INK_SUB = (120, 108, 116)     # grey text
WARN_BG = (255, 236, 216)     # soft orange
WARN_TXT = (190, 90, 20)      # orange text

FONT_BOLD = "/System/Library/Fonts/STHeiti Medium.ttc"
FONT_LIGHT = "/System/Library/Fonts/STHeiti Light.ttc"


def font(path, size, index=0):
    return ImageFont.truetype(path, size, index=index)


img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

# ---------- Header (pink gradient) ----------
header_h = 340
for y in range(header_h):
    t = y / header_h
    c = tuple(int(PINK[i] + (PINK_DEEP[i] - PINK[i]) * t) for i in range(3))
    d.line([(0, y), (W, y)], fill=c)

# gold accent line at header bottom
d.rectangle([0, header_h - 6, W, header_h], fill=GOLD)

# Header text
f_title = font(FONT_BOLD, 72)
f_sub = font(FONT_LIGHT, 40)
d.text((W // 2, 90), "Supabase 数据保存", font=f_title, fill=(255, 255, 255), anchor="ma")
d.text((W // 2, 185), "提醒卡", font=f_sub, fill=(255, 255, 255), anchor="ma")
d.text((W // 2, 255), "Enjoy Beauty 美业学习题库", font=f_sub, fill=(255, 240, 246), anchor="ma")

# ---------- Warning banner ----------
warn_y0, warn_y1 = header_h + 48, header_h + 176
d.rounded_rectangle([48, warn_y0, W - 48, warn_y1], radius=28, fill=WARN_BG)
f_warn = font(FONT_BOLD, 44)
d.text((W // 2, warn_y0 + 32), "数据不会丢，但「7 天不活跃」会自动暂停项目！", font=f_warn, fill=WARN_TXT, anchor="ma")
f_warn2 = font(FONT_LIGHT, 34)
d.text((W // 2, warn_y0 + 96), "暂停后学生打不开，需手动到后台恢复", font=f_warn2, fill=WARN_TXT, anchor="ma")

# ---------- 3 suggestion cards ----------
def draw_card(y, idx, tag, title, lines):
    card_h = 300
    d.rounded_rectangle([48, y, W - 48, y + card_h], radius=28, fill=CARD, outline=(240, 220, 230), width=3)
    # left pink bar
    d.rounded_rectangle([48, y + 24, 60, y + card_h - 24], radius=6, fill=PINK)
    # number circle
    cx, cy = 116, y + 70
    d.ellipse([cx - 44, cy - 44, cx + 44, cy + 44], fill=PINK)
    f_num = font(FONT_BOLD, 52)
    d.text((cx, cy), idx, font=f_num, fill=(255, 255, 255), anchor="mm")
    # tag pill
    f_tag = font(FONT_BOLD, 34)
    tag_w = d.textlength(tag, font=f_tag) + 40
    d.rounded_rectangle([cx + 60, cy - 28, cx + 60 + tag_w, cy + 28], radius=22, fill=GOLD)
    d.text((cx + 60 + tag_w // 2, cy), tag, font=f_tag, fill=(255, 255, 255), anchor="mm")
    # title
    f_title_card = font(FONT_BOLD, 48)
    d.text((cx + 60, y + 116), title, font=f_title_card, fill=INK, anchor="lm")
    # lines
    f_line = font(FONT_LIGHT, 36)
    ly = y + 188
    for ln in lines:
        d.text((cx + 60, ly), ln, font=f_line, fill=INK_SUB, anchor="lm")
        ly += 56
    return y + card_h + 40


y = warn_y1 + 48
y = draw_card(y, "1", "短期 · 不花钱",
              "学生打不开时，手动恢复即可",
              ["去 Supabase 后台点「Resume project」",
               "数据都还在，不用慌"])
y = draw_card(y, "2", "稳妥 · 推荐",
              "正式商用后升级 Pro 计划",
              ["$25/月 ≈ ¥180",
               "不再暂停 + 每日自动备份"])
y = draw_card(y, "3", "保险 · 双保险",
              "定期导出数据存本地",
              ["Studio → Tables → ⋯ → Export CSV",
               "备份一份到本地，万无一失"])

# ---------- Footer ----------
f_foot = font(FONT_LIGHT, 32)
d.text((W // 2, H - 70), "保存到相册，随时提醒自己", font=f_foot, fill=INK_SUB, anchor="mm")

img.save(OUT)
print("Saved", OUT)
