-- ============================================================
-- بيانات تجريبية — Seed Data
-- شغّل هذا الملف بعد schema.sql
-- ============================================================

-- ============================================================
-- الأصناف — Meals
-- ============================================================

-- وجبة الفطور — أصناف رئيسية
insert into meals (name, type, is_alternative) values
  ('بيض مسلوق', 'breakfast', false),
  ('فول مدمس', 'breakfast', false),
  ('خبز بالزعتر والزيت', 'breakfast', false);

-- وجبة الفطور — أصناف بديلة
insert into meals (name, type, is_alternative) values
  ('بيض مقلي', 'breakfast', true),
  ('جبنة بيضاء', 'breakfast', true),
  ('عسل وقشطة', 'breakfast', true);

-- وجبة الغداء — أصناف رئيسية
insert into meals (name, type, is_alternative) values
  ('أرز بالدجاج', 'lunch', false),
  ('مرق لحم مع خضار', 'lunch', false),
  ('معكرونة بالصلصة', 'lunch', false);

-- وجبة الغداء — أصناف بديلة
insert into meals (name, type, is_alternative) values
  ('أرز بالخضار', 'lunch', true),
  ('شوربة عدس', 'lunch', true),
  ('معكرونة بالزيت والثوم', 'lunch', true),
  ('سلطة خضار مشكلة', 'lunch', true);

-- وجبة العشاء — أصناف رئيسية
insert into meals (name, type, is_alternative) values
  ('سندويش فلافل', 'dinner', false),
  ('شاورما دجاج', 'dinner', false);

-- وجبة العشاء — أصناف بديلة
insert into meals (name, type, is_alternative) values
  ('سندويش جبنة مشوي', 'dinner', true),
  ('سلطة فتوش', 'dinner', true);

-- ============================================================
-- ربط البدائل بالأصناف الرئيسية
-- ============================================================

-- بيض مسلوق → [بيض مقلي، جبنة بيضاء]
insert into meal_alternatives (meal_id, alternative_id)
select m.id, a.id from meals m, meals a
where m.name = 'بيض مسلوق' and m.type = 'breakfast'
  and a.name in ('بيض مقلي', 'جبنة بيضاء') and a.type = 'breakfast';

-- فول مدمس → [عسل وقشطة، جبنة بيضاء]
insert into meal_alternatives (meal_id, alternative_id)
select m.id, a.id from meals m, meals a
where m.name = 'فول مدمس' and m.type = 'breakfast'
  and a.name in ('عسل وقشطة', 'جبنة بيضاء') and a.type = 'breakfast';

-- أرز بالدجاج → [أرز بالخضار، شوربة عدس]
insert into meal_alternatives (meal_id, alternative_id)
select m.id, a.id from meals m, meals a
where m.name = 'أرز بالدجاج' and m.type = 'lunch'
  and a.name in ('أرز بالخضار', 'شوربة عدس') and a.type = 'lunch';

-- مرق لحم مع خضار → [شوربة عدس، سلطة خضار مشكلة]
insert into meal_alternatives (meal_id, alternative_id)
select m.id, a.id from meals m, meals a
where m.name = 'مرق لحم مع خضار' and m.type = 'lunch'
  and a.name in ('شوربة عدس', 'سلطة خضار مشكلة') and a.type = 'lunch';

-- معكرونة بالصلصة → [معكرونة بالزيت والثوم]
insert into meal_alternatives (meal_id, alternative_id)
select m.id, a.id from meals m, meals a
where m.name = 'معكرونة بالصلصة' and m.type = 'lunch'
  and a.name = 'معكرونة بالزيت والثوم' and a.type = 'lunch';

-- شاورما دجاج → [سندويش جبنة مشوي، سلطة فتوش]
insert into meal_alternatives (meal_id, alternative_id)
select m.id, a.id from meals m, meals a
where m.name = 'شاورما دجاج' and m.type = 'dinner'
  and a.name in ('سندويش جبنة مشوي', 'سلطة فتوش') and a.type = 'dinner';

-- ============================================================
-- المستفيدون — Beneficiaries
-- ============================================================

insert into beneficiaries (name, code, category) values
  ('محمد أحمد العلي', 'EMP-001', 'موظف'),
  ('فاطمة سالم النجار', 'EMP-002', 'موظف'),
  ('عبدالله يوسف القحطاني', 'EMP-003', 'موظف'),
  ('نورة خالد المطيري', 'EMP-004', 'موظف'),
  ('أحمد عمر الشهراني', 'STU-001', 'طالب'),
  ('سارة محمد الغامدي', 'STU-002', 'طالب'),
  ('خالد عبدالرحمن الدوسري', 'STU-003', 'طالب'),
  ('ريم عيسى البلوي', 'GST-001', 'ضيف'),
  ('عمر ناصر الحربي', 'GST-002', 'ضيف');

-- ============================================================
-- الممنوعات — تعيين القيود الغذائية
-- ============================================================

-- محمد أحمد العلي — ممنوع من: بيض مسلوق، أرز بالدجاج
insert into exclusions (beneficiary_id, meal_id)
select b.id, m.id from beneficiaries b, meals m
where b.code = 'EMP-001' and m.name in ('بيض مسلوق', 'أرز بالدجاج');

-- فاطمة سالم النجار — ممنوعة من: فول مدمس، مرق لحم مع خضار
insert into exclusions (beneficiary_id, meal_id)
select b.id, m.id from beneficiaries b, meals m
where b.code = 'EMP-002' and m.name in ('فول مدمس', 'مرق لحم مع خضار');

-- عبدالله — ممنوع من: معكرونة بالصلصة، شاورما دجاج
insert into exclusions (beneficiary_id, meal_id)
select b.id, m.id from beneficiaries b, meals m
where b.code = 'EMP-003' and m.name in ('معكرونة بالصلصة', 'شاورما دجاج');

-- أحمد الطالب — ممنوع من: أرز بالدجاج
insert into exclusions (beneficiary_id, meal_id)
select b.id, m.id from beneficiaries b, meals m
where b.code = 'STU-001' and m.name = 'أرز بالدجاج';

-- سارة — ممنوعة من: شاورما دجاج، سندويش فلافل
insert into exclusions (beneficiary_id, meal_id)
select b.id, m.id from beneficiaries b, meals m
where b.code = 'STU-002' and m.name in ('شاورما دجاج', 'سندويش فلافل');
