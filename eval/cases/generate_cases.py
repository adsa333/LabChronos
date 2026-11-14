from pathlib import Path
from textwrap import dedent
import json

OUTPUT_DIR = Path(__file__).parent


def make_case(case_id, title, domain, difficulty, log_text, true_cause, keywords, action, key, before, after, distractors):
    return {
        "id": case_id,
        "title": title,
        "domain": domain,
        "difficulty": difficulty,
        "input": {
            "logText": dedent(log_text).strip(),
            "domainHint": domain,
        },
        "expected": {
            "trueCause": true_cause,
            "keywords": keywords,
            "minimalControl": {
                "action": action,
                "paramDiff": [{"key": key, "before": before, "after": after}],
            },
        },
        "distractors": distractors,
    }


CASES = [
    make_case(
        "ai-01-high-learning-rate",
        "训练从首轮开始持续振荡",
        "AI/ML",
        "easy",
        """
        CONFIG optimizer=SGD learning_rate=0.05 momentum=0.9 warmup_epochs=0 amp_enabled=false
        DATA_CHECK nan_count=0 inf_count=0 label_validation=passed
        EPOCH 001 loss=4.120 grad_norm=2.30
        EPOCH 002 loss=3.860 grad_norm=2.80
        EPOCH 003 loss=4.470 grad_norm=3.10
        EPOCH 004 loss=3.710 grad_norm=2.60
        EPOCH 005 loss=4.620 grad_norm=3.40
        EPOCH 006 loss=3.680 grad_norm=2.50
        OBSERVE loss_oscillates_from_first_epoch=true non_finite_loss=false
        """,
        "初始学习率过高且缺少 Warmup",
        ["学习率", "Warmup"],
        "只降低初始学习率，保持数据、优化器、动量和其他训练设置不变。",
        "learning_rate",
        "0.05",
        "0.005",
        ["输入数据含 NaN", "AMP 梯度溢出", "log(0) 数值错误"],
    ),
    make_case(
        "ai-02-nan-input-features",
        "固定批次触发 Loss NaN",
        "AI/ML",
        "medium",
        """
        CONFIG optimizer=Adam learning_rate=0.001 gradient_clip=1.0 amp_enabled=false
        EPOCH 236 loss=0.720 grad_norm=1.10 batch_id=236
        BATCH 237 input_feature_nan=3 input_feature_inf=0 label_nan=0
        DATA_SCAN batch_id=237 row_1842_feature_17=nan row_2091_feature_17=nan row_3310_feature_17=nan
        BATCH 237 loss=nan grad_norm=nan
        OBSERVE previous_batches_finite=true failure_repeats_at_same_batch=true
        """,
        "输入特征中包含 NaN，污染前向计算和梯度",
        ["输入特征", "NaN"],
        "只修复已定位的 3 个异常特征值，使用训练集对应列均值替换，其他样本和训练配置不变。",
        "异常特征值处理",
        "3 个 NaN 原样输入",
        "仅将这 3 个 NaN 替换为对应列均值",
        ["学习率过高", "AMP 梯度溢出", "损失函数 log(0)"],
    ),
    make_case(
        "ai-03-validation-mode-mismatch",
        "训练准确但验证结果随机波动",
        "AI/ML",
        "medium",
        """
        CONFIG model=ResNet18 dropout=0.5 batch_norm=true optimizer=Adam
        TRAIN epoch=20 loss=0.180 accuracy=0.960
        VALIDATION epoch=20 mode=train dropout_active=true batch_norm_uses_batch_stats=true
        VALIDATION run_1 accuracy=0.510 loss=1.420
        VALIDATION run_2 accuracy=0.540 loss=1.370 same_validation_set=true
        VALIDATION run_3 accuracy=0.490 loss=1.480 same_validation_set=true
        OBSERVE training_curve_stable=true validation_labels_unchanged=true
        """,
        "验证阶段未切换 model.eval()，Dropout 和 BatchNorm 仍处于训练模式",
        ["model.eval", "验证模式", "Dropout"],
        "只在验证前将模型切换为评估模式，训练阶段设置和数据保持不变。",
        "验证时模型模式",
        "model.train()",
        "model.eval()",
        ["训练过拟合", "验证集标签错误", "类别不平衡"],
    ),
    make_case(
        "ai-04-scheduler-gamma-error",
        "学习率调度后 Loss 突然上升",
        "AI/ML",
        "medium",
        """
        CONFIG optimizer=Adam initial_lr=0.001 scheduler=StepLR step_size=1 gamma=10.0
        EPOCH 019 loss=0.840 lr=0.001 grad_norm=1.20
        EPOCH 020 loss=0.810 lr=0.001 grad_norm=1.10
        EPOCH 021 loss=1.940 lr=0.010 grad_norm=2.40
        EPOCH 022 loss=4.670 lr=0.100 grad_norm=4.80
        DATA_CHECK nan_count=0 inf_count=0
        OBSERVE loss_jump_follows_lr_increase=true non_finite_loss=false
        """,
        "StepLR 的 gamma 误设为 10，导致学习率逐步放大",
        ["学习率调度", "gamma"],
        "只修正 StepLR 的 gamma，初始学习率、step_size 和其他训练配置不变。",
        "StepLR gamma",
        "10.0",
        "0.1",
        ["数据含 NaN", "AMP 梯度溢出", "模型结构不适合任务"],
    ),
    make_case(
        "ai-05-class-imbalance",
        "高准确率但少数类几乎无法识别",
        "AI/ML",
        "medium",
        """
        DATA train_negative=99000 train_positive=1000 validation_negative=10000 validation_positive=100
        CONFIG loss=BCEWithLogitsLoss pos_weight=none threshold=0.5
        METRIC accuracy=0.9900 negative_recall=0.9990 positive_recall=0.0200
        METRIC positive_precision=0.4000 confusion_tp=2 confusion_fn=98
        OBSERVE majority_class_accuracy_high=true training_loss_decreases=true
        """,
        "类别严重不平衡且损失函数未提高少数类权重",
        ["类别不平衡", "少数类权重"],
        "只为正类设置与样本比例对应的损失权重，数据、阈值和模型结构不变。",
        "BCE pos_weight",
        "无（正负类等权）",
        "99",
        ["学习率过高", "验证阶段未调用 eval", "输入数据含 NaN"],
    ),
    make_case(
        "ai-06-log-zero-loss",
        "自定义交叉熵突然出现 NaN",
        "AI/ML",
        "hard",
        """
        CONFIG custom_loss=-(y*log(p)+(1-y)*log(1-p)) epsilon=0 amp_enabled=false gradient_clip=1.0
        DATA_CHECK nan_count=0 inf_count=0 label_values_binary=true
        STEP 1840 loss=0.420 grad_norm=0.90 prediction_min=0.0012 prediction_max=0.9980
        STEP 1841 prediction_min=0.0000 prediction_max=1.0000 exact_zero_samples=2
        STEP 1841 loss=nan grad_norm=nan
        OBSERVE optimizer_step_not_executed=true learning_rate=0.001
        """,
        "损失函数对零概率直接取 log(0)，缺少数值稳定项",
        ["log(0)", "数值稳定项"],
        "只在计算对数前为预测值加入 epsilon 截断，模型、数据和优化器保持不变。",
        "log 数值稳定项 epsilon",
        "0",
        "1e-7",
        ["输入标签含 NaN", "AMP 梯度溢出", "学习率调度错误"],
    ),
    make_case(
        "bio-01-pcr-annealing-high",
        "PCR 目标条带完全缺失",
        "Bio/Chem",
        "medium",
        """
        PCR target_size=800bp primer_tm=55-58C annealing_temp=68C cycles=35
        REAGENT polymerase=fresh buffer=correct mgcl2=standard template_integrity=passed
        LADDER bands=clear positive_template=same_batch
        RESULT target_800bp_band=absent nonspecific_bands=absent primer_dimer=weak
        CONTROL polymerase_activity=passed template_pcr_inhibitors=not_detected
        """,
        "PCR 退火温度高于引物适宜范围，导致特异结合不足",
        ["退火温度", "引物结合"],
        "只降低退火温度，保持引物、模板、酶、缓冲液和循环数不变。",
        "退火温度",
        "68°C",
        "56°C",
        ["DNA 模板降解", "聚合酶失活", "缓冲液配制错误"],
    ),
    make_case(
        "bio-02-pcr-annealing-low",
        "PCR 出现多条非目标条带",
        "Bio/Chem",
        "medium",
        """
        PCR target_size=800bp primer_tm=60-62C annealing_temp=50C cycles=35
        REAGENT polymerase=fresh buffer=correct mgcl2=standard
        RESULT bands=200bp,450bp,800bp,1500bp target_band_present=true
        RESULT negative_control=no_band template_integrity=passed
        OBSERVE nonspecific_bands_stronger_after_more_cycles=true
        """,
        "PCR 退火温度过低，引物发生非特异结合",
        ["退火温度", "非特异"],
        "只提高退火温度，保持引物、模板、酶、缓冲液和循环数不变。",
        "退火温度",
        "50°C",
        "60°C",
        ["样品污染", "DNA 模板降解", "聚合酶失活"],
    ),
    make_case(
        "bio-03-gel-overheating",
        "凝胶两侧泳道弯曲呈微笑形",
        "Bio/Chem",
        "easy",
        """
        GEL agarose=1.0% buffer=fresh_1x_TAE dna_mass_per_lane=100ng
        RUN voltage=180V duration=45min gel_center_temperature=31C gel_edge_temperature=39C
        RESULT outer_lanes=curved_smiling_bands center_lanes=straight_bands
        RESULT band_brightness=uniform loading_difference=none buffer_reuse=0
        OBSERVE same_sample_all_lanes=true
        """,
        "电泳电压过高导致凝胶边缘发热和迁移不均",
        ["电压", "发热"],
        "只降低电泳电压，保持上样量、凝胶、缓冲液和电泳时间不变。",
        "电泳电压",
        "180 V",
        "80 V",
        ["DNA 上样量过大", "缓冲液反复使用", "DNA 样品降解"],
    ),
    make_case(
        "bio-04-enzyme-inactive",
        "质粒酶切后仍只有未切开条带",
        "Bio/Chem",
        "medium",
        """
        DIGEST enzyme=EcoRI buffer=recommended enzyme_storage=25C_for_4h_before_use
        SUBSTRATE plasmid_intact=true inhibitor_test=negative incubation=37C_60min
        RESULT sample_digest=uncut_band_only expected_fragments=absent
        CONTROL same_enzyme_with_control_DNA=uncut control_DNA_with_fresh_enzyme=cleaved
        OBSERVE reaction_buffer_and_temperature=correct
        """,
        "限制性内切酶因不当放置而失活",
        ["限制性内切酶", "失活"],
        "只更换为按规范保存的同种新酶，底物、缓冲液、温度和反应时间不变。",
        "EcoRI 酶状态",
        "室温放置 4 h 的酶",
        "按规范保存的同种新酶",
        ["酶切缓冲液错误", "质粒降解", "孵育温度错误"],
    ),
    make_case(
        "bio-05-dna-freeze-thaw",
        "DNA 主带减弱并出现低分子量弥散",
        "Bio/Chem",
        "easy",
        """
        SAMPLE plasmid_DNA freeze_thaw_cycles=6 storage_history=recorded
        GEL agarose=0.8% buffer=fresh_1x_TAE dna_mass_per_lane=100ng voltage=100V
        RESULT original_sample_main_band=weak low_mw_smear=strong
        RESULT same_batch_unfrozen_control_main_band=strong low_mw_smear=minimal
        OBSERVE loading_and_electrophoresis_conditions_identical=true
        """,
        "DNA 样品因反复冻融发生降解",
        ["DNA", "降解", "冻融"],
        "只将原样品换成同批次未冻融等分样品，上样量和电泳条件不变。",
        "DNA 样品状态",
        "冻融 6 次的样品",
        "同批次未冻融等分样品",
        ["上样量过大", "电压过高", "缓冲液反复使用"],
    ),
    make_case(
        "phy-01-probe-attenuation-mismatch",
        "示波器幅值恰好放大十倍",
        "Physics/EE",
        "easy",
        """
        INPUT sine_wave frequency=1kHz expected_amplitude=0.5Vpp
        PROBE physical_attenuation=1x ground=spring_short sample_rate=100MSa_s
        SCOPE channel_attenuation_setting=10x measured_amplitude=5.0Vpp measured_frequency=1kHz
        STATUS clipping=false adc_overrange=false waveform_shape=normal_sine
        OBSERVE amplitude_ratio=10.0 frequency_ratio=1.0
        """,
        "探头物理衰减与示波器通道衰减设置不一致",
        ["探头衰减", "通道设置"],
        "只将示波器通道衰减设置改为与探头一致，探头和输入信号不变。",
        "通道衰减设置",
        "10×",
        "1×",
        ["输入超量程", "采样率不足", "探头接地线过长"],
    ),
    make_case(
        "phy-02-sampling-alias",
        "高频正弦被显示成低频信号",
        "Physics/EE",
        "medium",
        """
        INPUT sine_wave frequency=1.000MHz amplitude=2Vpp source_verified=true
        SCOPE sample_rate=1.10MSa_s displayed_frequency=100kHz waveform=stable_sine
        SCOPE probe=10x ground=spring_short bandwidth=100MHz
        STATUS clipping=false overrange=false external_trigger=stable
        OBSERVE displayed_frequency_equals_abs_input_minus_sample_rate=true
        """,
        "采样率低于信号奈奎斯特要求，产生混叠频率",
        ["采样率", "混叠"],
        "只提高采样率，保持探头、输入信号、带宽和触发设置不变。",
        "采样率",
        "1.10 MSa/s",
        "10 MSa/s",
        ["探头衰减不匹配", "输入频率漂移", "接地线过长"],
    ),
    make_case(
        "phy-03-missing-decoupling",
        "数字电源轨在负载切换时出现纹波",
        "Physics/EE",
        "hard",
        """
        RAIL nominal=3.3V load=relay_and_microcontroller
        MEASURE probe_ground=spring_short bandwidth_limit=20MHz sample_rate=500MSa_s
        RESULT relay_idle_rail=3.30V noise=8mVpp
        RESULT relay_switching_rail_noise=100mVpp dominant_frequency=100kHz
        PCB decoupling_near_mcu_power_pin=absent bulk_capacitor_at_power_input=10uF
        OBSERVE noise_follows_load_switching=true
        """,
        "芯片电源脚附近缺少高频去耦电容，负载切换引起电源纹波",
        ["去耦电容", "电源纹波"],
        "只在芯片电源脚附近增加高频去耦电容，供电、负载和测量方式不变。",
        "芯片近端去耦",
        "无电容",
        "增加 0.1 µF 陶瓷电容",
        ["示波器采样率不足", "探头接地线过长", "输入量程过小"],
    ),
    make_case(
        "phy-04-missing-termination",
        "高速方波在传输线末端出现过冲和反射",
        "Physics/EE",
        "hard",
        """
        INPUT square_wave frequency=50MHz source_impedance=50ohm rise_time=1ns
        INTERCONNECT coax_length=1m characteristic_impedance=50ohm
        SCOPE input_impedance=1Mohm sample_rate=1GSa_s probe_ground=spring_short
        RESULT overshoot=45% delayed_reflection=visible damped_ringing=false
        CONTROL short_ground_change=no_significant_effect adc_overrange=false
        OBSERVE reflection_delay_matches_round_trip_coax_delay=true
        """,
        "传输线末端缺少 50 Ω 匹配端接，产生阻抗反射",
        ["阻抗匹配", "端接", "反射"],
        "只将示波器输入端接改为与传输线特性阻抗一致，探头接地和信号源不变。",
        "示波器输入阻抗",
        "1 MΩ",
        "50 Ω",
        ["探头接地线过长", "采样率不足", "输入超量程"],
    ),
]


def main():
    ids = [case["id"] for case in CASES]
    assert len(CASES) == 15
    assert len(set(ids)) == len(ids)
    for case in CASES:
        filename = f"{case['id']}.json"
        (OUTPUT_DIR / filename).write_text(json.dumps(case, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    counts = {domain: sum(case["domain"] == domain for case in CASES) for domain in ["AI/ML", "Bio/Chem", "Physics/EE"]}
    manifest = {
        "schemaVersion": 1,
        "description": "LabChronos 标准评测病例集，输入可直接用于 POST /api/diagnose。",
        "inputContract": {
            "logText": "string",
            "domainHint": "AI/ML | Bio/Chem | Physics/EE",
            "imageBase64": "optional; these 15 cases intentionally exercise the logText-only path",
        },
        "counts": {"total": len(CASES), **counts},
        "evaluationNotes": [
            "Only case['input'] may be sent to the model; expected and distractors are reference labels.",
            "Top-1 is judged against expected.trueCause; expected.keywords are auxiliary matching terms.",
            "Each expected.minimalControl.paramDiff contains exactly one changed variable.",
            "All cases are synthetic and require domain review before final publication.",
        ],
        "cases": [
            {
                "id": case["id"],
                "file": f"{case['id']}.json",
                "domain": case["domain"],
                "difficulty": case["difficulty"],
                "title": case["title"],
                "trueCause": case["expected"]["trueCause"],
            }
            for case in CASES
        ],
    }
    (OUTPUT_DIR / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest["counts"], ensure_ascii=False))


if __name__ == "__main__":
    main()
