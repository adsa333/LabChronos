from pathlib import Path
import json

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap
import numpy as np
from PIL import Image, ImageFilter

OUTPUT_DIR = Path(__file__).parent / "assets"
BG = "#0B0F14"
PANEL = "#101922"
GRID = "#293843"
TEXT = "#EAF4F2"
MUTED = "#8CA3AD"
GREEN = "#52D9B5"
AMBER = "#F2B35F"
RED = "#FF7B72"


def create_figure(title, subtitle):
    fig = plt.figure(figsize=(14, 9), dpi=100, facecolor=BG)
    fig.text(0.05, 0.94, title, color=TEXT, fontsize=22, fontweight="bold")
    fig.text(0.05, 0.905, subtitle, color=MUTED, fontsize=12, family="monospace")
    fig.text(0.95, 0.94, "SYNTHETIC CASE", color=MUTED, fontsize=11, family="monospace", ha="right")
    return fig


def style_axis(ax, title):
    ax.set_facecolor(PANEL)
    ax.set_title(title, color=TEXT, fontsize=15, loc="left", pad=16)
    ax.tick_params(colors=MUTED, labelsize=10)
    ax.grid(True, color=GRID, linewidth=0.8, alpha=0.8)
    for spine in ax.spines.values():
        spine.set_color(GRID)
    ax.xaxis.label.set_color(MUTED)
    ax.yaxis.label.set_color(MUTED)


def normalized_data_bbox(fig, ax, corners):
    fig.canvas.draw()
    points = [ax.transData.transform(point) for point in corners]
    (x0, y0), (x1, y1) = points
    width, height = fig.canvas.get_width_height()
    x = min(x0, x1) / width
    y = 1 - max(y0, y1) / height
    w = abs(x1 - x0) / width
    h = abs(y1 - y0) / height
    return [round(value, 4) for value in (x, y, w, h)]


def generate_ai_training():
    fig = create_figure(
        "Training failure evidence — Loss NaN",
        "SGD · lr=0.05 · AMP enabled · no gradient clipping · fixed data order (seed 42)",
    )
    loss_ax = fig.add_axes([0.065, 0.16, 0.405, 0.66])
    grad_ax = fig.add_axes([0.56, 0.16, 0.405, 0.66])
    epochs = np.arange(1, 15)
    loss = np.array([4.2, 3.35, 2.85, 2.55, 2.4, 2.2, 2.05, 1.9, 1.75, 1.5, 1.42, 1.31, 1.2, 9.8])
    grad = np.array([0.82, 0.9, 0.95, 1.02, 1.1, 1.2, 1.32, 1.4, 1.5, 1.62, 1.9, 3.8, 128.6, 48_500])

    style_axis(loss_ax, "Training Loss")
    loss_ax.set_xlim(1, 20)
    loss_ax.set_ylim(0, 11)
    loss_ax.set_xlabel("Epoch")
    loss_ax.set_ylabel("Cross-entropy Loss")
    loss_ax.axvspan(14.5, 20, color=RED, alpha=0.08)
    loss_ax.axvline(14, color=RED, linestyle="--", linewidth=1.5, alpha=0.8)
    loss_ax.plot(epochs, loss, color=GREEN, linewidth=3, marker="o", markersize=4)
    loss_ax.scatter([14], [9.8], s=90, color=RED, zorder=5)
    loss_ax.annotate("Epoch 14: Loss = 9.80\nthen NaN", xy=(14, 9.8), xytext=(15.1, 8.2), color=RED, fontsize=12, fontweight="bold", arrowprops={"arrowstyle": "->", "color": RED})
    loss_ax.text(14.8, 4.8, "NaN", color=RED, fontsize=24, fontweight="bold")

    style_axis(grad_ax, "Gradient norm (log scale)")
    grad_ax.set_xlim(1, 20)
    grad_ax.set_ylim(0.1, 100_000)
    grad_ax.set_yscale("log")
    grad_ax.set_xlabel("Epoch")
    grad_ax.set_ylabel("grad_norm")
    grad_ax.plot(epochs, grad, color=AMBER, linewidth=3, marker="o", markersize=4)
    grad_ax.scatter([14], [48_500], s=100, color=RED, zorder=5)
    grad_ax.annotate("4.85e4 (finite, not skipped)", xy=(14, 48_500), xytext=(9.8, 18_000), color=RED, fontsize=12, fontweight="bold", arrowprops={"arrowstyle": "->", "color": RED})
    grad_ax.annotate("128.6", xy=(13, 128.6), xytext=(10.8, 900), color=AMBER, fontsize=11, arrowprops={"arrowstyle": "->", "color": AMBER})

    fig.text(0.065, 0.075, "Epoch 13: loss=1.20, grad_norm=128.6", color=MUTED, fontsize=12, family="monospace")
    fig.text(0.56, 0.095, "Epoch 14: grad_norm=48500 (unclipped step)", color=RED, fontsize=10.5, family="monospace", fontweight="bold")
    fig.text(0.56, 0.065, "-> Epoch 15 Loss NaN", color=RED, fontsize=10.5, family="monospace", fontweight="bold")
    fig.text(0.065, 0.04, "Observed order: gradient anomaly precedes parameter and loss failure.", color=MUTED, fontsize=11)
    bbox = normalized_data_bbox(fig, loss_ax, [(13.3, 10.8), (19.6, 0.5)])
    fig.savefig(OUTPUT_DIR / "ai-training-nan.png", dpi=100, facecolor=BG)
    fig.savefig(OUTPUT_DIR / "ai-training-nan.svg", facecolor=BG)
    plt.close(fig)
    return {"s1": bbox}


def generate_gel():
    width, height = 1280, 800
    yy, xx = np.mgrid[0:height, 0:width]
    rng = np.random.default_rng(42)
    gel = np.clip(rng.normal(0.015, 0.004, (height, width)), 0, None)

    def band(cx, cy, sx, sy, intensity):
        return intensity * np.exp(-0.5 * (((xx - cx) / sx) ** 2 + ((yy - cy) / sy) ** 2))

    for cy, intensity in [(150, 0.5), (230, 0.7), (320, 0.8), (430, 0.75), (560, 0.65), (690, 0.5)]:
        gel += band(140, cy, 36, 7, intensity)

    lanes = [(340, 100), (540, 250), (740, 500), (940, 500), (1140, 100)]
    for cx, mass in lanes:
        load = mass / 500
        gel += band(cx, 470, 34 + 18 * load, 9 + 6 * load, 0.5 + 0.65 * load)
        tail_start = 460
        tail_mask = yy <= tail_start
        spread = 16 + 28 * load + 0.035 * np.maximum(tail_start - yy, 0)
        tail = (0.08 + 0.7 * load) * np.exp(-0.5 * ((xx - cx) / spread) ** 2) * np.exp(-np.maximum(tail_start - yy, 0) / (130 + 100 * load))
        gel += tail * tail_mask
        gel += band(cx, 440, 28 + 25 * load, 25 + 25 * load, 0.12 + 0.2 * load)

    gel_image = Image.fromarray(np.uint8(np.clip(gel / gel.max(), 0, 1) * 255), mode="L").filter(ImageFilter.GaussianBlur(2.2))
    gel = np.asarray(gel_image).astype(float) / 255

    fig = create_figure(
        "DNA gel electrophoresis — loading-dependent smearing",
        "0.8% agarose · 1× TAE · 100 V · 35 min · same DNA sample",
    )
    ax = fig.add_axes([0.05, 0.14, 0.9, 0.72])
    cmap = LinearSegmentedColormap.from_list("gel", ["#031015", "#07313B", "#1E8D96", "#70F5E7", "#D0FFF7"])
    ax.imshow(gel, cmap=cmap, vmin=0, vmax=0.92, aspect="auto")
    ax.set_xlim(0, width)
    ax.set_ylim(height, 0)
    ax.set_xticks([])
    ax.set_yticks([])
    for spine in ax.spines.values():
        spine.set_color("#31515B")
        spine.set_linewidth(2)

    labels = [(140, "Marker"), (340, "100 ng"), (540, "250 ng"), (740, "500 ng"), (940, "500 ng"), (1140, "100 ng")]
    for cx, label in labels:
        ax.text(cx, 48, label, color=TEXT, fontsize=12, ha="center", family="monospace", fontweight="bold")
        ax.add_patch(plt.Rectangle((cx - 45, 72), 90, 28, facecolor="#020609", edgecolor="#31515B", linewidth=1.5))
    ax.text(340, 760, "narrow band", color=MUTED, fontsize=10, ha="center")
    ax.text(540, 760, "moderate upward tail", color=MUTED, fontsize=10, ha="center")
    ax.text(740, 760, "strong upward tail", color=MUTED, fontsize=10, ha="center")
    ax.text(940, 760, "replicate", color=MUTED, fontsize=10, ha="center")
    ax.text(1140, 760, "narrow band", color=MUTED, fontsize=10, ha="center")
    fig.text(0.05, 0.065, "Observation: strong main bands remain visible; smearing extends toward loading wells (high-MW side).", color=MUTED, fontsize=12, family="monospace")

    s1 = normalized_data_bbox(fig, ax, [(665, 170), (1015, 520)])
    s2 = normalized_data_bbox(fig, ax, [(690, 185), (790, 515)])
    fig.savefig(OUTPUT_DIR / "gel-electrophoresis-smearing.png", dpi=100, facecolor=BG)
    fig.savefig(OUTPUT_DIR / "gel-electrophoresis-smearing.svg", facecolor=BG)
    plt.close(fig)
    return {"s1": s1, "s2": s2}


def generate_oscilloscope():
    fig = create_figure(
        "Oscilloscope evidence — edge-triggered damped ringing",
        "CH1 · 1 MHz square wave · steady 2 Vpp · peaks 4 Vpp · 500 MSa/s · 24 MHz ringing",
    )
    ax = fig.add_axes([0.065, 0.15, 0.9, 0.68])
    t = np.linspace(0, 4, 5000)
    phase = np.mod(t, 1.0)
    waveform = np.where(phase < 0.5, 1.0, -1.0)
    for index, edge in enumerate(np.arange(0, 4.01, 0.5)):
        dt = t - edge
        active = dt >= 0
        direction = 1 if index % 2 == 0 else -1
        ringing = 1.15 * np.exp(-np.maximum(dt, 0) / 0.055) * np.sin(2 * np.pi * 24 * np.maximum(dt, 0))
        waveform[active] += direction * ringing[active]

    style_axis(ax, "CH1 — measured waveform")
    ax.set_xlim(0, 4)
    ax.set_ylim(-2.5, 2.5)
    ax.set_xlabel("Time (µs)")
    ax.set_ylabel("Voltage (V)")
    ax.plot(t, waveform, color="#70F0A8", linewidth=2.2)
    ax.axhline(1, color=MUTED, linewidth=0.8, alpha=0.35)
    ax.axhline(-1, color=MUTED, linewidth=0.8, alpha=0.35)
    ax.annotate("Overshoot + damped ringing", xy=(1.03, 1.75), xytext=(1.35, 2.15), color=AMBER, fontsize=12, fontweight="bold", arrowprops={"arrowstyle": "->", "color": AMBER})
    ax.annotate("flat high level\nno continuous ripple", xy=(1.25, 1), xytext=(2.15, 1.55), color=MUTED, fontsize=11, arrowprops={"arrowstyle": "->", "color": MUTED})
    fig.text(0.70, 0.85, "no flat-top clipping / no ADC overrange", color=MUTED, fontsize=11)
    fig.text(0.065, 0.065, "Probe ground: 10 cm clip lead to a remote ground point · stable levels remain flat between transitions", color=MUTED, fontsize=11, family="monospace")

    s1 = normalized_data_bbox(fig, ax, [(0.96, 2.25), (1.28, 0.55)])
    s2 = normalized_data_bbox(fig, ax, [(0.96, 2.25), (1.47, 0.65)])
    fig.savefig(OUTPUT_DIR / "oscilloscope-ringing.png", dpi=100, facecolor=BG)
    fig.savefig(OUTPUT_DIR / "oscilloscope-ringing.svg", facecolor=BG)
    plt.close(fig)
    return {"s1": s1, "s2": s2}


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    boxes = {
        "ai-training-nan": generate_ai_training(),
        "gel-electrophoresis-smearing": generate_gel(),
        "oscilloscope-ringing": generate_oscilloscope(),
    }
    print(json.dumps(boxes, indent=2))


if __name__ == "__main__":
    main()
