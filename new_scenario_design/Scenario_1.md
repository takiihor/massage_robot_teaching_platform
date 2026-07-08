Scenario 1：15分鐘時「無疼痛」（No pain at 15th min）

起始狀態 (Baseline - 1.1)
├── 患者：心率 89 bpm、血壓 115/73、SpO₂ 97%、呼吸 18 次/分
├── 疼痛：0/5、焦慮：0/5、舒適度：2/5
├── 對話：「Hi, nurse. Wow, a robotic massage? Is that really useful for me?」
│
└─ 按摩進行 5 分鐘後（學生回應對話後，實時 1 分鐘） → 狀態 1.2
    ├── 心率 86 bpm、血壓 98/65、SpO₂ 97%、呼吸 14 次/分
    ├── 疼痛 0/5、焦慮 0/5、舒適度 3/5
    ├── 對話：「Oh hi, it’s you again. I really feel like my body and blood are circulating! It’s working! I feel like qi firm squeeze... so relaxing!」

    ├── 學生選擇：停止按摩？ 
    │   └─ 是 → 狀態 1.3.a（mild anxiety）
    │       ├── 心率 88 bpm、血壓 103/66、SpO₂ 97%、呼吸 16 次/分
    │       ├── 疼痛 0/5、焦慮 2/5、舒適度 0/5
    │       ├── 對話：「Why are you stopping it? I’m just starting to feel it working! Is there something wrong?」
    │       └── 結束 → 進入 debriefing
    │
    └─ 否（繼續按摩）→ 再過 15 分鐘（實時 1 分鐘後回應）→ 狀態 1.3.b.1（mild pain）
        ├── 心率 102 bpm、血壓 115/72、SpO₂ 95%、呼吸 20 次/分
        ├── 疼痛 2/5、焦慮 3/5、舒適度 1/5
        ├── 對話：「Well… It’s hard to tell, but there’s some kind of ‘pain’ in my left leg… AND I don’t know what’s going on, but I feel like I can’t catch my breath, like a little bit.」
        └── 如果此時「停止」， 就停留在 1.3.b.1（mild pain）
            ├── 心率 102 bpm、血壓 115/72、SpO₂ 95%、呼吸 20 次/分
            ├── 疼痛 2/5、焦慮 3/5、舒適度 1/5
        └── 如果「繼續」→ 再過 15 分鐘（實時 30 秒後回應）→ 狀態 1.3.b.2（high anxiety）
            ├── 心率 115 bpm、血壓 116/76、SpO₂ 94%、呼吸 22 次/分
            ├── 疼痛 2/5、焦慮 4/5、舒適度 1/5
            ├── 對話：「Nurse! Help me! It’s getting harder to breathe. I can’t catch it!!」
            └── 完成 & debriefing
