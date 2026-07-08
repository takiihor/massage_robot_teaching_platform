Scenario 2：中度／重度疼痛（moderate / severe pain）

起始狀態 (Baseline - 1.1)
├── 心率 89 bpm、血壓 115/73、SpO₂ 97%、呼吸 18 次/分
├── 疼痛 0/5（但後續快速惡化）、焦慮 0/5、舒適度 2/5
├── 對話：「Hi, nurse. Wow, a robotic massage? Is that really useful for me?」

└─ 按摩進行 5 分鐘後 → 狀態 1.2（high anxiety）
    ├── 心率 103 bpm、血壓 122/84、SpO₂ 94%、呼吸 24 次/分
    ├── 疼痛 5/5、焦慮 4/5、舒適度 0/5
    ├── 對話：「Ah! Is it really normal for me to feel this kind of pain? My chest is feeling a little tight now. But I still can handle it… continue!」

    ├── 學生選擇：停止按摩？
    │   └─ 是 → 狀態 1.3.a（moderate pain）
    │       ├── 心率 101 bpm、血壓 121/83、SpO₂ 94%、呼吸 22 次/分
    │       ├── 疼痛 5/5、焦慮 3/5、舒適度 0/5
    │       ├── 對話：「Oh! Thanks for stopping the machine! I still can’t breathe good… But is there something wrong?」
    │       └── 完成 → debriefing
    │
    └─ 否（繼續按摩）→ 再過 15 分鐘
        └── 狀態 1.3.b（severe pain）
            ├── 心率 119 bpm、血壓 143/95、SpO₂ 93%、呼吸 26 次/分
            ├── 疼痛 5/5、焦慮 5/5、舒適度 0/5
            ├── 對話：「Ow! Wait! That’s painful! My left leg hurts so bad! My chest is feeling tight! I can’t breathe at all!!」
            └── severe pain & high anxiety → 完成 → debriefing
