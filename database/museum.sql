CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.museum_rooms (
  code text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  owner_id text NOT NULL,
  pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.museum_members (
  room_code text NOT NULL REFERENCES app.museum_rooms(code) ON DELETE CASCADE,
  user_id text NOT NULL,
  nickname text NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_code, user_id)
);

CREATE TABLE IF NOT EXISTS app.museum_entries (
  id text PRIMARY KEY,
  room_code text NOT NULL REFERENCES app.museum_rooms(code) ON DELETE CASCADE,
  author_id text NOT NULL,
  author_name text NOT NULL,
  title text NOT NULL,
  domain text NOT NULL,
  truth_title text NOT NULL,
  probability double precision NOT NULL,
  locked_id text,
  action text NOT NULL,
  param_diff jsonb NOT NULL DEFAULT '[]'::jsonb,
  symptom_summary text NOT NULL,
  log text NOT NULL DEFAULT '',
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  diagnosis jsonb NOT NULL,
  base_same_trap integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.museum_traps (
  entry_id text NOT NULL REFERENCES app.museum_entries(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entry_id, user_id)
);

CREATE TABLE IF NOT EXISTS app.museum_comments (
  id text PRIMARY KEY,
  entry_id text NOT NULL REFERENCES app.museum_entries(id) ON DELETE CASCADE,
  author_id text NOT NULL,
  author_name text NOT NULL,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS museum_members_user_id_idx ON app.museum_members (user_id);
CREATE INDEX IF NOT EXISTS museum_entries_room_created_idx ON app.museum_entries (room_code, created_at DESC);
CREATE INDEX IF NOT EXISTS museum_comments_entry_created_idx ON app.museum_comments (entry_id, created_at ASC);

INSERT INTO app.museum_rooms (code, name, description, owner_id, pinned, created_at)
VALUES (
  'LAB-2826',
  'LabChronos 跨学科翻车公开馆',
  '汇聚 AI / 生化 / 物理电子真实实验排障记录——只存脱敏取证与单变量处方，让每一次失败变成下一次实验的坐标。',
  'seed-chen-ai',
  true,
  '2026-11-20T08:00:00Z'
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO app.museum_members (room_code, user_id, nickname, joined_at)
VALUES
  ('LAB-2826', 'seed-chen-ai', '陈同学 · 视觉计算组', '2026-11-20T08:00:00Z'),
  ('LAB-2826', 'seed-shen-bio', '沈同学 · 分子生信组', '2026-11-20T08:05:00Z'),
  ('LAB-2826', 'seed-lu-phy', '陆同学 · 射频与测控组', '2026-11-20T08:10:00Z'),
  ('LAB-2826', 'seed-gao-qpcr', '高同学 · 细胞转录组', '2026-11-20T08:15:00Z'),
  ('LAB-2826', 'seed-lin-multimodal', '林师兄 · 多模态组', '2026-11-20T08:20:00Z'),
  ('LAB-2826', 'seed-xu-protein', '许师姐 · 蛋白表达组', '2026-11-20T08:25:00Z')
ON CONFLICT (room_code, user_id) DO NOTHING;

INSERT INTO app.museum_entries (
  id, room_code, author_id, author_name, title, domain, truth_title, probability, locked_id,
  action, param_diff, symptom_summary, log, answers, diagnosis, base_same_trap, created_at
)
VALUES (
  'seed-ai-nan',
  'LAB-2826',
  'seed-chen-ai',
  '陈同学 · 视觉计算组',
  'SGD + AMP 第 14 轮大梯度未裁剪导致次轮 Loss NaN',
  'AI/ML',
  '未执行梯度裁剪，Epoch 14 有限大梯度（4.85e4）直接更新参数引发次轮 NaN',
  0.6296,
  'h1',
  '在 scaler.unscale_(optimizer) 后、scaler.step(optimizer) 前调用 clip_grad_norm_(model.parameters(), max_norm=1.0)，保持 SGD、lr=0.05、AMP 及固定 seed 不变；预期 Epoch 14 梯度范数受控且 Epoch 15–20 Loss 平稳下降，不再出现 NaN',
  '[{"key":"clip_grad_norm_","before":"未启用","after":"1.0"}]'::jsonb,
  'Epoch 14 有限大梯度 4.85e4 未裁剪，Epoch 15 Loss NaN',
  'CONFIG optimizer=SGD lr=0.05 amp_enabled=true gradient_clipping=disabled seed=fixed
EPOCH 13 loss=1.21 grad_norm=42.0
EPOCH 14 loss=9.80 grad_norm=4.85e4
EPOCH 15 loss=nan grad_norm=inf
NOTE Data order fixed by seed',
  '{"q1":1,"q2":0}'::jsonb,
  $diag_ai_nan${
    "caseTitle":"SGD + AMP 大梯度未裁剪导致 Loss NaN",
    "domain":"AI/ML",
    "observedSymptoms":[
      {"id":"s1","label":"Epoch 14 后 Loss 变为 NaN","detail":"固定 seed 下 Epoch 14 记录 grad_norm=4.85e4，Epoch 15 Loss=NaN。","severity":"critical","source":"log"},
      {"id":"s2","label":"AMP 开启但未执行梯度裁剪","detail":"配置为 amp_enabled=true、gradient_clipping=disabled。","severity":"critical","source":"log"},
      {"id":"s3","label":"前 13 轮 Loss 正常下降","detail":"Epoch 13 Loss=1.21，异常仅在梯度峰值后出现。","severity":"warning","source":"log"}
    ],
    "hypotheses":[
      {"id":"h1","title":"未执行梯度裁剪导致参数更新溢出","mechanism":"AMP 反缩放后的有限大梯度未裁剪，直接更新参数并引发次轮非有限值。","priorScore":50,"evidenceFor":["s1","s2","s3"],"subCauses":["有限大梯度不会触发 GradScaler skip","未裁剪梯度令参数更新幅度失控"],"minimalControl":{"action":"仅在 unscale_ 后增加 clip_grad_norm_(max_norm=1.0)。","paramDiff":[{"key":"clip_grad_norm_","before":"未启用","after":"1.0"}],"expectedOutcome":"Epoch 15–20 Loss 保持有限并继续下降。"}},
      {"id":"h2","title":"学习率过大导致训练振荡","mechanism":"SGD 学习率 0.05 可能放大参数更新并造成训练发散。","priorScore":30,"evidenceFor":["s3"],"subCauses":["初始学习率偏高","缺少 Warmup 缓冲"],"minimalControl":{"action":"只把学习率从 0.05 降到 0.005。","paramDiff":[{"key":"learning_rate","before":"0.05","after":"0.005"}],"expectedOutcome":"若为主因，梯度峰值和 Loss 跳变应减弱。"}},
      {"id":"h3","title":"输入批次含 NaN 或 Inf","mechanism":"非有限输入会直接污染前向计算、损失和梯度。","priorScore":20,"evidenceFor":["s3"],"subCauses":["异常特征进入前向计算","异常标签污染损失"],"minimalControl":{"action":"只对固定批次执行 NaN/Inf 全量扫描。","paramDiff":[{"key":"数据完整性检查","before":"未执行","after":"遍历固定批次"}],"expectedOutcome":"若数据全部有限，则不支持该假设。"}}
    ],
    "questions":[
      {"id":"q1","prompt":"仅启用梯度裁剪后 Epoch 15 是否仍为 NaN？","howToCheck":"保持 seed、学习率和数据顺序不变，只增加 clip_grad_norm_(1.0) 重跑。","options":[{"label":"不再出现 NaN","scoreDelta":{"h1":25,"h2":-10,"h3":-20}},{"label":"仍然出现 NaN","scoreDelta":{"h1":-20,"h2":20,"h3":20}},{"label":"不确定","scoreDelta":{"h1":0,"h2":0,"h3":0}}]},
      {"id":"q2","prompt":"固定 seed 下异常是否总在梯度峰值后出现？","howToCheck":"按 step 对齐 grad_norm 与 Loss，确认 NaN 的先后顺序。","options":[{"label":"总在梯度峰值后出现","scoreDelta":{"h1":20,"h2":-10,"h3":-15}},{"label":"与梯度峰值无时序关系","scoreDelta":{"h1":-15,"h2":20,"h3":20}},{"label":"不确定","scoreDelta":{"h1":0,"h2":0,"h3":0}}]}
    ]
  }$diag_ai_nan$::jsonb,
  14,
  '2026-11-21T09:00:00Z'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO app.museum_entries (
  id, room_code, author_id, author_name, title, domain, truth_title, probability, locked_id,
  action, param_diff, symptom_summary, log, answers, diagnosis, base_same_trap, created_at
)
VALUES (
  'seed-bio-gel',
  'LAB-2826',
  'seed-shen-bio',
  '沈同学 · 分子生信组',
  '琼脂糖凝胶电泳 500 ng 双泳道主带增宽并向上拖尾',
  'Bio/Chem',
  'DNA 上样质量过载（单孔 500 ng 超出 0.8% 凝胶孔承载能力导致迁移滞后）',
  0.6364,
  'h1',
  '保持同胶、等体积 10 μL、100 V / 35 min、1× TAE 不变，仅将单孔 DNA 上样量从 500 ng 降至 100 ng；预期向上拖尾（朝加样孔/高分子量侧）消失，恢复与对照孔一致的锐利单主带',
  '[{"key":"DNA 上样量","before":"500 ng","after":"100 ng"}]'::jsonb,
  '500 ng 双泳道主带增宽并向加样孔拖尾',
  'GEL_PREP agarose=0.8% buffer=1x_TAE same_batch=true
LANE_2 dna_mass=100ng total_load_volume=10uL
LANE_4 dna_mass=500ng total_load_volume=10uL
OBSERVE lane_4=wide_main_band comet_tail_toward_loading_well
SUMMARY smearing_increases_with_loading_mass=true',
  '{"q1":0,"q2":1}'::jsonb,
  $diag_bio_gel${
    "caseTitle":"DNA 上样过载导致条带增宽并向上拖尾",
    "domain":"Bio/Chem",
    "observedSymptoms":[
      {"id":"s1","label":"500 ng 泳道主带增宽并拖尾","detail":"两条 500 ng 重复泳道均出现明亮宽主带和彗星状拖尾。","severity":"critical","source":"log"},
      {"id":"s2","label":"拖尾朝向加样孔方向","detail":"弥散位于主带的高分子量侧，而不是低分子量侧。","severity":"critical","source":"log"},
      {"id":"s3","label":"100 ng 对照孔主带锐利","detail":"同胶同批样品的 100 ng 对照孔仅有轻微拖尾。","severity":"warning","source":"log"}
    ],
    "hypotheses":[
      {"id":"h1","title":"DNA 上样量过大导致凝胶过载","mechanism":"过量 DNA 超过凝胶局部承载能力，使条带展宽并向加样孔滞后拖尾。","priorScore":50,"evidenceFor":["s1","s2","s3"],"subCauses":["局部 DNA 浓度超过分离容量","过载导致迁移与染色不均"],"minimalControl":{"action":"仅将单孔上样量从 500 ng 降为 100 ng。","paramDiff":[{"key":"DNA 上样量","before":"500 ng","after":"100 ng"}],"expectedOutcome":"拖尾消失并恢复锐利单主带。"}},
      {"id":"h2","title":"电泳电压过高导致发热","mechanism":"过高电压造成焦耳热和迁移不均，可能使条带变形。","priorScore":30,"evidenceFor":["s1"],"subCauses":["凝胶局部温度升高","离子迁移速率不均"],"minimalControl":{"action":"仅将电压从 100 V 降为 70 V。","paramDiff":[{"key":"电泳电压","before":"100 V","after":"70 V"}],"expectedOutcome":"若发热为主因，高上样量泳道拖尾也应明显减轻。"}},
      {"id":"h3","title":"DNA 样品反复冻融降解","mechanism":"核酸断裂会形成低分子量连续弥散并减弱主带。","priorScore":20,"evidenceFor":["s1"],"subCauses":["反复冻融造成链断裂","短片段形成低分子量弥散"],"minimalControl":{"action":"仅更换同批次未冻融样品并保持 500 ng。","paramDiff":[{"key":"DNA 样品状态","before":"原样品","after":"未冻融等分样品"}],"expectedOutcome":"若降解为主因，主带应减弱并出现低分子量弥散。"}}
    ],
    "questions":[
      {"id":"q1","prompt":"拖尾是否随上样量增加而加重？","howToCheck":"比较同胶 100 ng 与 500 ng 泳道，其他条件保持一致。","options":[{"label":"上样量越高拖尾越重","scoreDelta":{"h1":25,"h2":-10,"h3":-15}},{"label":"不同上样量无明显差异","scoreDelta":{"h1":-20,"h2":20,"h3":20}},{"label":"不确定","scoreDelta":{"h1":0,"h2":0,"h3":0}}]},
      {"id":"q2","prompt":"主带是否仍完整而非低分子量弥散？","howToCheck":"检查弥散相对主带的位置与分子量方向。","options":[{"label":"低分子量连续弥散","scoreDelta":{"h1":-20,"h2":0,"h3":30}},{"label":"主带完整且仅向上拖尾","scoreDelta":{"h1":20,"h2":10,"h3":-30}},{"label":"不确定","scoreDelta":{"h1":0,"h2":0,"h3":0}}]}
    ]
  }$diag_bio_gel$::jsonb,
  11,
  '2026-11-21T09:10:00Z'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO app.museum_entries (
  id, room_code, author_id, author_name, title, domain, truth_title, probability, locked_id,
  action, param_diff, symptom_summary, log, answers, diagnosis, base_same_trap, created_at
)
VALUES (
  'seed-phy-ringing',
  'LAB-2826',
  'seed-lu-phy',
  '陆同学 · 射频与测控组',
  '1 MHz 方波上升沿 24 MHz 阻尼振铃（稳态 2 Vpp / 峰值 4 Vpp）',
  'Physics/EE',
  '示波器探针 10 cm 长接地夹引入寄生电感，与输入电容形成 LC 欠阻尼谐振',
  0.8,
  'h1',
  '同一通道与 1 MHz 信号源不变，仅将 10 cm 长鳄鱼夹改为探针短接地弹簧就近接地；预期上升/下降沿 24 MHz 过冲振铃大幅收敛，峰峰值回到 2 Vpp 左右',
  '[{"key":"探针接地方式","before":"10 cm 长鳄鱼夹","after":"探针短接地弹簧就近接地"}]'::jsonb,
  '1 MHz 方波边沿 24 MHz 阻尼振铃，稳态 2 Vpp',
  'INPUT square frequency=1MHz steady_state=2Vpp peak_with_overshoot=4Vpp
PROBE_GROUND style=clip_lead length=10cm
PHYSICS rise_time=4ns ringing_freq=24MHz probe_capacitance=12pF
STATUS adc_overrange=false flat_top_clipping=false
OBSERVE ringing_follows_fast_edges=true continuous_ripple=false',
  '{"q1":1,"q2":0}'::jsonb,
  $diag_phy_ring${
    "caseTitle":"探头长接地线引发 24 MHz 阻尼振铃",
    "domain":"Physics/EE",
    "observedSymptoms":[
      {"id":"s1","label":"快速边沿后出现阻尼振铃","detail":"上升沿和下降沿后均有 24 MHz 衰减振荡。","severity":"critical","source":"log"},
      {"id":"s2","label":"稳态电平无连续纹波","detail":"振铃只跟随快速边沿，平顶与低电平稳定。","severity":"critical","source":"log"},
      {"id":"s3","label":"探头使用 10 cm 长接地夹","detail":"接地夹线远离测试点，形成较大回路电感。","severity":"warning","source":"log"}
    ],
    "hypotheses":[
      {"id":"h1","title":"探头接地线过长形成 LC 谐振","mechanism":"长接地线电感与探头输入电容形成欠阻尼谐振，被快速边沿激励。","priorScore":50,"evidenceFor":["s1","s2","s3"],"subCauses":["接地回路电感过大","探头电容与回路电感谐振"],"minimalControl":{"action":"仅将长接地夹改为短接地弹簧。","paramDiff":[{"key":"探针接地方式","before":"10 cm 鳄鱼夹","after":"短接地弹簧"}],"expectedOutcome":"24 MHz 过冲振铃显著收敛。"}},
      {"id":"h2","title":"输入超出量程导致削波","mechanism":"输入过大会削平波形，但通常不产生边沿后阻尼振荡。","priorScore":30,"evidenceFor":["s1"],"subCauses":["量程设置过小","输入幅度超过线性范围"],"minimalControl":{"action":"仅将量程扩大到 ±10 V。","paramDiff":[{"key":"输入量程","before":"±4 V","after":"±10 V"}],"expectedOutcome":"若仅为削波，平顶会恢复但振铃机制不同。"}},
      {"id":"h3","title":"源端与传输线阻抗不匹配","mechanism":"阻抗失配会产生反射，在快速边沿形成过冲或回波。","priorScore":20,"evidenceFor":["s1"],"subCauses":["源端缺少匹配","互连反射叠加"],"minimalControl":{"action":"仅在源端串联 33 Ω。","paramDiff":[{"key":"源端串联电阻","before":"0 Ω","after":"33 Ω"}],"expectedOutcome":"若反射为主因，过冲应减弱。"}}
    ],
    "questions":[
      {"id":"q1","prompt":"振铃是否只在快速边沿后出现？","howToCheck":"展开稳定电平段，检查是否存在连续周期波动。","options":[{"label":"稳定段有连续周期波动","scoreDelta":{"h1":-20,"h2":0,"h3":25}},{"label":"仅边沿后出现阻尼振铃","scoreDelta":{"h1":25,"h2":-10,"h3":-15}},{"label":"不确定","scoreDelta":{"h1":0,"h2":0,"h3":0}}]},
      {"id":"q2","prompt":"改用短接地弹簧后振铃是否显著减弱？","howToCheck":"只改变接地方式并叠加比较边沿波形。","options":[{"label":"振铃明显减弱","scoreDelta":{"h1":25,"h2":-10,"h3":-20}},{"label":"振铃基本不变","scoreDelta":{"h1":-20,"h2":10,"h3":20}},{"label":"不确定","scoreDelta":{"h1":0,"h2":0,"h3":0}}]}
    ]
  }$diag_phy_ring$::jsonb,
  9,
  '2026-11-21T09:20:00Z'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO app.museum_entries (
  id, room_code, author_id, author_name, title, domain, truth_title, probability, locked_id,
  action, param_diff, symptom_summary, log, answers, diagnosis, base_same_trap, created_at
)
VALUES (
  'seed-bio-qpcr',
  'LAB-2826',
  'seed-gao-qpcr',
  '高同学 · 细胞转录组',
  'SYBR Green qPCR 引物二聚体扩增（NTC 起峰 + 74.2℃ 低温熔解峰）',
  'Bio/Chem',
  $truth_qpcr$引物 3' 端自互补评分过高且 55℃ 退火偏低，导致 NTC 形成 55 bp 引物二聚体$truth_qpcr$,
  0.8,
  'h1',
  '先不换试剂与体系，单变量将退火温度从 55℃ 提高至 60℃ 验证温度敏感性；预期 74.2℃ 低温杂峰与 55 bp 模糊带消失，NTC 无扩增或 Ct > 35',
  '[{"key":"anneal_temp","before":"55℃","after":"60℃"}]'::jsonb,
  'NTC 起峰 Ct 31.8，74.2℃ 低温熔解峰，55 bp 二聚体带',
  'QPCR chemistry=SYBR_Green anneal_temp=55C
NTC amplification=true Ct=31.8
MELT peak=74.2C target_peak=82.1C
GEL product_band=55bp fuzzy
PRIMER self_complementarity_score=high',
  '{"q1":0,"q2":0}'::jsonb,
  $diag_bio_qpcr${
    "caseTitle":"SYBR Green qPCR 引物二聚体扩增",
    "domain":"Bio/Chem",
    "observedSymptoms":[
      {"id":"s1","label":"NTC 出现扩增 Ct 31.8","detail":"无模板对照起峰且 Ct 明显早于 35。","severity":"critical","source":"log"},
      {"id":"s2","label":"熔解曲线出现 74.2℃ 低温峰","detail":"目标产物峰位于 82.1℃，另有 74.2℃ 低温杂峰。","severity":"critical","source":"log"},
      {"id":"s3","label":"产物凝胶出现 55 bp 模糊带","detail":"产物长度明显短于目标扩增子。","severity":"warning","source":"log"}
    ],
    "hypotheses":[
      {"id":"h1","title":"引物二聚体形成（Primer Dimer）","mechanism":"引物 3' 端自互补并在 55℃ 退火时相互延伸，形成短二聚体产物。","priorScore":50,"evidenceFor":["s1","s2","s3"],"subCauses":["引物 3' 端自互补评分过高","55℃ 退火温度偏低"],"minimalControl":{"action":"仅将退火温度从 55℃ 提高到 60℃。","paramDiff":[{"key":"anneal_temp","before":"55℃","after":"60℃"}],"expectedOutcome":"NTC 无扩增或 Ct>35，74.2℃ 杂峰消失。"}},
      {"id":"h2","title":"模板基因组 DNA 残留","mechanism":"RNA 样品中的 gDNA 残留可扩增出目标或非特异产物。","priorScore":30,"evidenceFor":["s1"],"subCauses":["RNA 未充分 DNase 处理","引物跨越外显子边界不足"],"minimalControl":{"action":"仅增加 DNase 消化后重复逆转录。","paramDiff":[{"key":"gDNA 处理","before":"未消化","after":"DNase 消化"}],"expectedOutcome":"若 gDNA 为主因，NTC 仍不应出现目标扩增。"}},
      {"id":"h3","title":"试剂或环境交叉污染","mechanism":"污染模板或扩增产物进入反应体系会导致 NTC 起峰。","priorScore":20,"evidenceFor":["s1"],"subCauses":["移液器或环境气溶胶污染","无酶水或试剂被污染"],"minimalControl":{"action":"仅更换全新无酶水与未开封试剂。","paramDiff":[{"key":"试剂批次","before":"在用批次","after":"全新批次"}],"expectedOutcome":"若污染为主因，更换试剂后 NTC 转阴。"}}
    ],
    "questions":[
      {"id":"q1","prompt":"退火温度提高到 60℃ 后 NTC 是否仍扩增？","howToCheck":"保持引物与体系不变，只将退火温度从 55℃ 提到 60℃ 重跑 NTC。","options":[{"label":"NTC 不再扩增或 Ct>35","scoreDelta":{"h1":25,"h2":-20,"h3":-20}},{"label":"NTC 仍明显扩增","scoreDelta":{"h1":-20,"h2":25,"h3":25}},{"label":"不确定","scoreDelta":{"h1":0,"h2":0,"h3":0}}]},
      {"id":"q2","prompt":"更换全新无酶水与 SYBR 试剂后 NTC 状态？","howToCheck":"仅更换试剂与无酶水，保持引物和程序不变重跑 NTC。","options":[{"label":"NTC 仍扩增且 Ct 基本不变","scoreDelta":{"h1":20,"h2":-10,"h3":-20}},{"label":"NTC 转阴且扩增消失","scoreDelta":{"h1":-20,"h2":10,"h3":25}},{"label":"不确定","scoreDelta":{"h1":0,"h2":0,"h3":0}}]}
    ]
  }$diag_bio_qpcr$::jsonb,
  16,
  '2026-11-21T09:30:00Z'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO app.museum_comments (id, entry_id, author_id, author_name, text, created_at)
VALUES
  ('seed-comment-ai-1', 'seed-ai-nan', 'seed-lin-multimodal', '林师兄 · 多模态组', '同款坑！之前一直以为 GradScaler 会自动拦住所有大梯度，后来才发现有限大梯度 4.85e4 根本不会触发 skip，必须在 scaler.unscale_(optimizer) 之后紧跟 clip_grad_norm_(1.0)。', '2026-11-21T09:05:00Z'),
  ('seed-comment-ai-2', 'seed-ai-nan', 'seed-zhou-nlp', '周同学 · NLP 研一', '照着单变量处方只加了这一行，其他学习率和数据顺序全没动，14 轮顺利过关，省了重扫超参的两天卡时！', '2026-11-21T09:08:00Z'),
  ('seed-comment-bio-1', 'seed-bio-gel', 'seed-xu-protein', '许师姐 · 蛋白表达组', '刚开始差点当成核酸酶降解把整管质粒扔了，看到拖尾是朝加样孔向上而不是向下低分子量弥散，按处方稀释到 100 ng 重跑立刻锐利如刀！', '2026-11-21T09:15:00Z'),
  ('seed-comment-bio-2', 'seed-bio-gel', 'seed-zhao-ferment', '赵同学 · 发酵工程', '提醒大家同体积稀释时别改上样缓冲液盐浓度，只降 DNA 质量最稳。', '2026-11-21T09:18:00Z'),
  ('seed-comment-phy-1', 'seed-phy-ringing', 'seed-he-power', '何师兄 · 电源硬件组', '太真实了，组会前我差点连夜改 PCB 端接电阻，换上短接地弹簧一测，振铃直接没了——原来板子根本没坏，是探针地线在骗人。', '2026-11-21T09:25:00Z'),
  ('seed-comment-phy-2', 'seed-phy-ringing', 'seed-wu-embedded', '吴同学 · 嵌入式研二', '稳态平顶没有连续纹波就是典型边沿寄生电感特征，这条存进馆里以后新进组师弟直接看。', '2026-11-21T09:28:00Z'),
  ('seed-comment-qpcr-1', 'seed-bio-qpcr', 'seed-sun-immuno', '孙师姐 · 免疫学实验室', '之前一看到 NTC 起峰就以为试剂污染全套重买，结果贴进 LabChronos 一看 74.2℃ 低温峰 + 55 bp 短带直接锁死引物二聚体，提到 60℃ 退火一次过！', '2026-11-21T09:35:00Z'),
  ('seed-comment-qpcr-2', 'seed-bio-qpcr', 'seed-chen-molbio', '陈同学 · 分子生物学', '如果提到 60℃ 后 NTC 还是起峰，再按第 2 题排查更换无酶水验证是否合并污染，逻辑特别清晰。', '2026-11-21T09:38:00Z')
ON CONFLICT (id) DO NOTHING;