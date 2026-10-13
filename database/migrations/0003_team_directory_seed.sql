BEGIN;

-- Seed the screenshot roster only for a source whose owner list has not been
-- configured yet. Existing custom lists are preserved.
UPDATE source_configs
SET owner_names = '["毕梓浩","盛永帮","刘媛媛","李晨璐","史东升","贾浩","兰谊伟"]'::jsonb,
    updated_at = now()
WHERE owner_names = '[]'::jsonb;

-- Keep analysis provenance versioned while making the initial module dictionary
-- immediately active. Do not replace a non-empty dictionary already maintained.
DO $$
DECLARE
  next_version integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM module_dictionary_versions
    WHERE status = 'published' AND jsonb_array_length(entries) > 0
  ) THEN
    UPDATE module_dictionary_versions SET status = 'retired' WHERE status = 'published';
    SELECT COALESCE(MAX(version), 0) + 1 INTO next_version FROM module_dictionary_versions;
    INSERT INTO module_dictionary_versions(version, status, entries, created_by, created_at, published_at)
    VALUES (
      next_version,
      'published',
      '[
        {"name":"爬坡","personName":"毕梓浩"},
        {"name":"赛段","personName":"毕梓浩"},
        {"name":"训练-骑行台训练","personName":"毕梓浩"},
        {"name":"训练-模拟路线","personName":"毕梓浩"},
        {"name":"训练-课程训练","personName":"毕梓浩"},
        {"name":"训练-训练计划","personName":"毕梓浩"},
        {"name":"天气风向收益","personName":"毕梓浩"},
        {"name":"地图","personName":"盛永帮"},
        {"name":"导航（路线/离线/位置点）","personName":"盛永帮"},
        {"name":"AI意图导航","personName":"盛永帮"},
        {"name":"自行车防盗","personName":"盛永帮"},
        {"name":"急弯陡坡","personName":"盛永帮"},
        {"name":"声音提示","personName":"刘媛媛"},
        {"name":"语音播报","personName":"刘媛媛"},
        {"name":"星环","personName":"刘媛媛"},
        {"name":"AI码表设置","personName":"刘媛媛"},
        {"name":"码表桌面伴侣（结合充电底座）","personName":"刘媛媛"},
        {"name":"语音控制","personName":"刘媛媛"},
        {"name":"初次使用（海思新平台）","personName":"刘媛媛"},
        {"name":"团队骑行","personName":"刘媛媛"},
        {"name":"实时对讲","personName":"刘媛媛"},
        {"name":"摔倒检测","personName":"刘媛媛"},
        {"name":"电源管理（海思新平台）","personName":"李晨璐"},
        {"name":"消息通知（海思新平台）","personName":"李晨璐"},
        {"name":"骑行记录","personName":"李晨璐"},
        {"name":"历史记录","personName":"李晨璐"},
        {"name":"个人资料","personName":"李晨璐"},
        {"name":"数据计算","personName":"李晨璐"},
        {"name":"数据展示","personName":"李晨璐"},
        {"name":"迈金系多语言","personName":"李晨璐"},
        {"name":"场景+表盘+场景设置（海思新平台）","personName":"史东升"},
        {"name":"车辆+传感器（海思新平台）","personName":"史东升"},
        {"name":"数据传输","personName":"史东升"},
        {"name":"数据埋点","personName":"史东升"},
        {"name":"智联助手以及三者","personName":"史东升"},
        {"name":"码表设置-App端","personName":"贾浩"},
        {"name":"固件升级","personName":"贾浩"},
        {"name":"车辆传感器（后续转交）","personName":"贾浩"},
        {"name":"消息通知（后续转交）","personName":"贾浩"},
        {"name":"音乐控制","personName":"贾浩"},
        {"name":"自定义按键","personName":"贾浩"},
        {"name":"新手引导","personName":"贾浩"},
        {"name":"帮助中心","personName":"贾浩"},
        {"name":"极游系多语言","personName":"贾浩"},
        {"name":"码表设置-码表端","personName":"兰谊伟"},
        {"name":"App端通用设置","personName":"兰谊伟"},
        {"name":"日志/异常文件管理","personName":"兰谊伟"},
        {"name":"电源管理（后续转交）","personName":"兰谊伟"},
        {"name":"GNSS管理","personName":"兰谊伟"},
        {"name":"显示设置","personName":"兰谊伟"},
        {"name":"系统管理","personName":"兰谊伟"},
        {"name":"偏好设置","personName":"兰谊伟"},
        {"name":"锁屏/解锁","personName":"兰谊伟"},
        {"name":"场景+表盘+场景设置（后续转交）","personName":"兰谊伟"}
      ]'::jsonb,
      'system', now(), now()
    );
  END IF;
END $$;

COMMIT;
