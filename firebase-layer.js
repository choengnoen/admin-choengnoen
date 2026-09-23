/* ==========================================================================
   firebase-layer.js — ชั้นเชื่อมต่อ Firebase (Authentication + Firestore)
   ระบบงานบริหารหมวด หมวดทางหลวงเชิงเนิน (ฉบับ Firestore — แทน Code.gs + Google Sheets เดิม)

   ใช้ร่วมกันทั้ง 5 หน้า (ระบบหลัก + ระบบรอง 1-4) — แต่ละหน้าโหลดไฟล์นี้ด้วย
     <script src="firebase-layer.js" data-page="main|s1|s2|s3|s4"></script>

   ทำหน้าที่:
     - ล็อกอินครั้งเดียวใช้ได้ทุกหน้า (Firebase Auth จำสถานะไว้ในเบราว์เซอร์ให้เอง)
     - สิทธิ์ผู้ใช้ 4 บทบาท (เจ้าของระบบ / หมวด / ผู้ช่วยหมวด / เจ้าหน้าที่) + ปรับสิทธิ์รายคนได้
       บังคับจริงที่ firestore.rules — ส่วนในหน้าเว็บเป็นแค่การซ่อนปุ่มให้ใช้งานสะดวก
     - apiGet / apiGetMultiple / apiPost หน้าตาเหมือน Code.gs เดิมทุกประการ (หน้าเว็บเดิมเรียกใช้ต่อได้เลย)
       แต่ข้อมูลอยู่ใน Firestore แบบ realtime + แคชในเครื่อง (เปิดครั้งต่อไปเร็วมาก)
     - ลบ = ย้ายไป "ถังขยะ" เสมอ (กู้คืนได้) และบันทึกประวัติการใช้งาน (activity_log) ในคำสั่งเดียวกัน
     - สถานะออนไลน์ของผู้ใช้ (presence), ค่าสถานะที่ใช้ร่วมกันของแต่ละหน้า (app_state)
     - นำเข้าข้อมูลจากไฟล์ Excel ที่ export จาก Google Sheet เดิม (ทางเลือก) และส่งออกทั้งระบบ

   หมายเหตุ: ค่า firebaseConfig ด้านล่างเป็นค่าสาธารณะโดยออกแบบ (ไม่ใช่รหัสลับ) ความปลอดภัยจริงอยู่ที่ firestore.rules
   ========================================================================== */
(function () {
  'use strict';

  // ★ ขั้นตอนติดตั้ง: แก้ค่าด้านล่างเป็นค่าจริงจาก Firebase Console (ดู คู่มือติดตั้ง-อ่านก่อน.md ขั้นที่ 5)
  const firebaseConfig = {
    apiKey: "AIzaSyABFKObhcuC-dqpZLKNwgU8n37uiek8YsQ",
    authDomain: "choengnoen-admin.firebaseapp.com",
    projectId: "choengnoen-admin",
    storageBucket: "choengnoen-admin.firebasestorage.app",
    messagingSenderId: "742610487352",
    appId: "1:742610487352:web:9446cbf814e05d384cfecd"
  };

  // ล็อกอินด้วยชื่อผู้ใช้ (username) แต่ Firebase Auth ต้องใช้อีเมล จึงสร้างอีเมลสังเคราะห์ให้แต่ละบัญชี
  // (โดเมน .invalid เป็นโดเมนที่ไม่มีอยู่จริงตามมาตรฐาน — ไม่มีการส่งอีเมลใดๆ ออกไปทั้งสิ้น)
  const EMAIL_DOMAIN = 'choengnoen-admin.invalid';
  const PROFILE_CACHE_KEY = 'cn_admin_profile_v1';     // โปรไฟล์ล่าสุด ใช้แสดงหน้าได้ทันทีไม่ต้องรอเน็ต (สิทธิ์จริงอยู่ที่ Rules)
  const LEGACY_SESSION_KEY = 'saraban_shared_session'; // คีย์เดิมที่หน้าเว็บเก่าอ่าน — เขียนให้เพื่อความเข้ากันได้

  const FBL = {};
  window.FBL = FBL;

  const scriptEl = document.currentScript;
  FBL.page = (scriptEl && scriptEl.dataset.page) || 'main';

  /* ======================================================================
     หน้า/ส่วนงาน และบทบาท
     ====================================================================== */
  const SECTIONS = {
    main: { key: 'main', no: '•', label: 'งานบริหารหมวด', short: 'ระบบหลัก', file: 'choengnoen0-main.html' },
    s1: { key: 's1', no: '1', label: 'งานสารบรรณและบุคลากร', short: 'ระบบ 1', file: 'choengnoen1-saraban.html' },
    s2: { key: 's2', no: '2', label: 'งานสถิติและบริการประชาชน', short: 'ระบบ 2', file: 'choengnoen2-statistics.html' },
    s3: { key: 's3', no: '3', label: 'งานพัสดุและเครื่องจักร', short: 'ระบบ 3', file: 'choengnoen3-supplies.html' },
    s4: { key: 's4', no: '4', label: 'งานบัญชีและการเงิน', short: 'ระบบ 4', file: 'choengnoen4-finance.html' }
  };
  const SUB_KEYS = ['s1', 's2', 's3', 's4'];
  FBL.SECTIONS = SECTIONS;
  FBL.SUB_KEYS = SUB_KEYS;

  // สิทธิ์พิเศษ (นอกเหนือจาก ดู/แก้ไข รายระบบ) — ชื่อและคำอธิบายใช้แสดงในหน้า "ผู้ใช้งานและสิทธิ์"
  const FLAGS = [
    { key: 'delete', label: 'ลบรายการ', desc: 'ลบข้อมูลในระบบที่ตัวเองแก้ไขได้ (รายการจะไปอยู่ในถังขยะ กู้คืนได้)' },
    { key: 'restore', label: 'กู้คืนจากถังขยะ', desc: 'ดูถังขยะและกู้คืนรายการที่ถูกลบ' },
    { key: 'purge', label: 'ลบถาวร', desc: 'ลบรายการในถังขยะทิ้งถาวร (กู้คืนไม่ได้อีก)' },
    { key: 'viewLog', label: 'ดูประวัติการใช้งาน', desc: 'ดูว่าใครเพิ่ม/แก้ไข/ลบอะไร เมื่อไร และดูสถานะออนไลน์' },
    { key: 'unlockLedger', label: 'ปลดล็อกบัญชีรายเดือน', desc: 'ปลดล็อกเดือนที่ปิดบัญชี พ.1-02 / พ.1-03 แล้ว' },
    { key: 'export', label: 'ส่งออก/สำรองข้อมูล', desc: 'ดาวน์โหลดข้อมูลทั้งระบบเป็น Excel / JSON' }
  ];
  FBL.FLAGS = FLAGS;

  const ROLES = {
    owner: { key: 'owner', label: 'เจ้าของระบบ', icon: '👑', desc: 'สิทธิ์เต็มทุกอย่าง + จัดการผู้ใช้งาน (มีได้คนเดียว)' },
    chief: { key: 'chief', label: 'หมวด', icon: '🎖️', desc: 'หัวหน้าหมวด — ดูได้ทุกระบบและภาพรวม ดูประวัติ/ส่งออกได้ แต่ไม่แก้ไขข้อมูล' },
    assistant: { key: 'assistant', label: 'ผู้ช่วยหมวด', icon: '🛡️', desc: 'แก้ไขได้ทุกระบบ ลบ/กู้คืนถังขยะได้ ปลดล็อกบัญชีได้ (ลบถาวรและจัดการผู้ใช้ไม่ได้)' },
    staff: { key: 'staff', label: 'เจ้าหน้าที่', icon: '👤', desc: 'แก้ไขได้เฉพาะส่วนงานที่รับผิดชอบ ส่วนงานอื่นดูอย่างเดียว ไม่เห็นระบบหลัก' }
  };
  FBL.ROLES = ROLES;

  // สิทธิ์ตั้งต้นของแต่ละบทบาท (เจ้าของระบบปรับรายคนได้ภายหลังในหน้า "ผู้ใช้งานและสิทธิ์")
  function presetPerm(role, sections) {
    const own = Array.isArray(sections) ? sections : [];
    const p = { main: false, s1: 'view', s2: 'view', s3: 'view', s4: 'view', delete: false, restore: false, purge: false, viewLog: false, unlockLedger: false, export: false };
    if (role === 'owner') {
      Object.assign(p, { main: true, s1: 'edit', s2: 'edit', s3: 'edit', s4: 'edit', delete: true, restore: true, purge: true, viewLog: true, unlockLedger: true, export: true });
    } else if (role === 'chief') {
      Object.assign(p, { main: true, viewLog: true, export: true });
    } else if (role === 'assistant') {
      Object.assign(p, { main: true, s1: 'edit', s2: 'edit', s3: 'edit', s4: 'edit', delete: true, restore: true, viewLog: true, unlockLedger: true, export: true });
    } else { // staff
      SUB_KEYS.forEach(function (k) { if (own.indexOf(k) !== -1) p[k] = 'edit'; });
      p.delete = own.length > 0;
    }
    return p;
  }
  FBL.presetPerm = presetPerm;

  function normalizePerm(perm, role) {
    const base = presetPerm(role || 'staff', []);
    const p = Object.assign({}, base, perm || {});
    SUB_KEYS.forEach(function (k) { if (['edit', 'view', 'none'].indexOf(p[k]) === -1) p[k] = base[k]; });
    p.main = !!p.main;
    FLAGS.forEach(function (f) { p[f.key] = !!p[f.key]; });
    if (role === 'owner') return presetPerm('owner');
    return p;
  }
  FBL.normalizePerm = normalizePerm;

  /* ======================================================================
     โครงสร้างตาราง (คัดลอกจาก TABLES ใน Code.gs เดิม — ลำดับคอลัมน์ไม่สำคัญแล้วใน Firestore)
     section = ส่วนงานเจ้าของตาราง (ใช้ตัดสินสิทธิ์แก้ไข) / trash:false = ลบแล้วไม่ต้องเข้าถังขยะ (ข้อมูลเชิงเทคนิค)
     ====================================================================== */
  const TABLES = {
    staff: { section: 's1', label: 'บุคลากร', idField: 'id', idPrefix: 'STF', columns: ['id', 'name', 'role', 'duty', 'ptype', 'rate', 'status', 'startDate', 'birth', 'lastUpdated', 'nickname', 'shirt', 'med', 'phone', 'address', 'education', 'emergencyContact', 'emergencyPhone', 'bloodType'], numericFields: ['rate'] },
    leave_requests: { section: 's1', label: 'การลา', idField: 'id', idPrefix: 'LV', columns: ['id', 'name', 'type', 'from', 'to', 'days', 'reason', 'cover', 'contact', 'status', 'recordedDate', 'advanceDays', 'lastUpdated'], numericFields: ['days', 'advanceDays'] },
    public_holidays: { section: 's1', label: 'วันหยุดนักขัตฤกษ์', idField: 'date', idPrefix: null, columns: ['date', 'name', 'lastUpdated'], numericFields: [] },
    complaints: { section: 's1', label: 'คำร้องทุกข์', idField: 'id', idPrefix: 'CPL', columns: ['id', 'date', 'receiveNo', 'route', 'km', 'subject', 'remark', 'status', 'lastUpdated', 'updatesJson'], numericFields: [] },

    controlled_routes: { section: 's2', label: 'ทางหลวงควบคุม', idField: 'id', idPrefix: 'RTE', columns: ['id', 'highway', 'sectionName', 'kmStart', 'kmEnd', 'lastUpdated', 'controlNo', 'rangesJson', 'distActual', 'dist2Lane', 'asphalt', 'concrete', 'workQty'], numericFields: ['kmStart', 'kmEnd', 'distActual', 'dist2Lane', 'asphalt', 'concrete', 'workQty'], jsonFields: ['rangesJson'] },
    field_crews: { section: 's2', label: 'ชุดปฏิบัติงาน', idField: 'id', idPrefix: 'CREW', columns: ['id', 'name', 'leader', 'membersJson', 'lastUpdated'], numericFields: [], jsonFields: ['membersJson'] },
    job_code_reference: { section: 's2', label: 'รหัสงาน', idField: 'jobCode', idPrefix: null, columns: ['jobCode', 'jobName', 'unit', 'category', 'lastUpdated', 'level', 'parent', 'parentName', 'output', 'description'], numericFields: [] },
    daily_work_orders: { section: 's2', label: 'ใบสั่งการรายวัน', idField: 'id', idPrefix: 'DWO', columns: ['id', 'fiscalYear', 'date', 'jobCode', 'routeValue', 'routeLabel', 'kmStart', 'kmEnd', 'side', 'workQuantity', 'staffJson', 'materialsJson', 'machineryJson', 'laborCost', 'materialCost', 'rentCost', 'fuelCost', 'totalCost', 'note', 'lastUpdated', 'qtyPending', 'unit', 'staffLabel', 'vehicleLabelsText'], numericFields: ['fiscalYear', 'workQuantity', 'laborCost', 'materialCost', 'rentCost', 'fuelCost', 'totalCost'], jsonFields: ['staffJson', 'materialsJson', 'machineryJson'] },
    bmm_plan_actual: { section: 's2', label: 'แผน-ผลงาน', idField: 'id', idPrefix: 'BMM', columns: ['id', 'fiscalYear', 'month', 'jobCode', 'planQty', 'actualQty', 'lastUpdated', 'unit', 'name', 'level', 'kind', 'material', 'labor', 'rent', 'fuel', 'service', 'contract', 'supplementLogJson', 'baseline', 'asOfMonth'], numericFields: ['fiscalYear', 'month', 'planQty', 'actualQty', 'material', 'labor', 'rent', 'fuel', 'service', 'contract', 'asOfMonth'], jsonFields: ['supplementLogJson'] },
    unit_cost_records: { section: 's2', label: 'Unit Cost', idField: 'id', idPrefix: 'UC', columns: ['id', 'jobCode', 'fiscalYear', 'materialCostPerDay', 'laborCostPerDay', 'fuelCostPerDay', 'rentCostPerDay', 'qtyPerDay', 'unitCost', 'lastUpdated', 'jobName', 'unit', 'laborRowsJson', 'materialRowsJson', 'vehicleRowsJson', 'variantLabel'], numericFields: ['fiscalYear', 'materialCostPerDay', 'laborCostPerDay', 'fuelCostPerDay', 'rentCostPerDay', 'qtyPerDay', 'unitCost'], jsonFields: ['laborRowsJson', 'materialRowsJson', 'vehicleRowsJson'] },
    permits: { section: 's2', label: 'ขออนุญาตในเขตทาง', idField: 'no', idPrefix: null, columns: ['no', 'type', 'name', 'phone', 'km', 'doc', 'status', 'lastUpdated'], numericFields: ['no'] },
    encroachments: { section: 's2', label: 'งานรุกล้ำ', idField: 'code', idPrefix: null, columns: ['code', 'name', 'km', 'dist', 'structure', 'stage', 'stageDate', 'cleared', 'clearedDate', 'lastUpdated'], numericFields: ['dist', 'stage'] },
    emergencies: { section: 's2', label: 'เหตุฉุกเฉิน', idField: 'no', idPrefix: null, columns: ['no', 'type', 'loc', 'start', 'lastUpdate', 'status', 'lastUpdated'], numericFields: ['no'] },

    materials: { section: 's3', label: 'ทะเบียนพัสดุ', idField: 'code', idPrefix: null, columns: ['code', 'itemName', 'category', 'unit', 'openingStock', 'reorderPoint', 'status', 'lastUpdated', 'unitPrice'], numericFields: ['openingStock', 'reorderPoint', 'unitPrice'] },
    material_transactions: { section: 's3', label: 'รับ-จ่ายวัสดุ', idField: 'id', idPrefix: 'MTX', columns: ['id', 'materialId', 'type', 'qty', 'unitPrice', 'totalPrice', 'refNo', 'date', 'note', 'relatedDailyWorkOrderId', 'lastUpdated'], numericFields: ['qty', 'unitPrice', 'totalPrice'] },
    machinery: { section: 's3', label: 'เครื่องจักร/ยานพาหนะ', idField: 'id', idPrefix: 'MCH', columns: ['id', 'regNumber', 'vehicleType', 'operatorName', 'mileageThresholdOverride', 'status', 'lastUpdated', 'label', 'fuelType', 'fuelRate', 'fuelRateUnit', 'monthlyRent'], numericFields: ['mileageThresholdOverride', 'fuelRate', 'monthlyRent'] },
    fuel_transactions: { section: 's3', label: 'รับ-จ่ายน้ำมัน', idField: 'id', idPrefix: 'FUEL', columns: ['id', 'vehicleId', 'fuelType', 'date', 'qty', 'mileage', 'note', 'lastUpdated', 'kind', 'ref', 'unitPrice', 'totalPrice', 'relatedDailyWorkOrderId'], numericFields: ['qty', 'mileage', 'unitPrice', 'totalPrice'] },
    machinery_logs: { section: 's3', label: 'บันทึกใช้เครื่องจักร (EC 1-W)', idField: 'id', idPrefix: 'LOG', columns: ['id', 'vehicleId', 'date', 'hrWO', 'hrFS', 'otherUnitCode', 'dayOff', 'routeValueOverride', 'routeLabelOverride', 'note', 'lastUpdated', 'driver', 'hrW', 'hrM', 'hrC', 'hrV', 'hrO', 'hrF', 'hrR', 'hrS', 'otherReason', 'locationsJson'], numericFields: ['hrWO', 'hrFS', 'hrW', 'hrM', 'hrC', 'hrV', 'hrO', 'hrF', 'hrR', 'hrS'], jsonFields: ['locationsJson'] },
    vehicle_requests: { section: 's3', label: 'ขอใช้รถ', idField: 'id', idPrefix: 'VEQ', columns: ['id', 'requesterName', 'vehicleId', 'purpose', 'dateFrom', 'dateTo', 'destination', 'approverName', 'status', 'lastUpdated', 'requestDate', 'requesterPosition', 'passengers', 'driverName', 'mileageStart', 'mileageEnd', 'routeNosJson'], numericFields: ['passengers', 'mileageStart', 'mileageEnd'], jsonFields: ['routeNosJson'] },
    vehicle_mileage_log: { section: 's3', label: 'เลขไมล์รายวัน', idField: 'id', idPrefix: 'VML', columns: ['id', 'vehicleId', 'date', 'mileage', 'lastUpdated'], numericFields: [], trash: false },
    fuel_settings: { section: 's3', label: 'จุดสั่งซื้อน้ำมัน', idField: 'fuelType', idPrefix: null, columns: ['fuelType', 'reorderPoint', 'lastUpdated'], numericFields: ['reorderPoint'], trash: false },
    ledger_locks: { section: 's3', label: 'ล็อกเดือนบัญชี', idField: 'monthKey', idPrefix: null, columns: ['monthKey', 'lockedBy', 'lockedAt', 'lastUpdated'], numericFields: [], trash: false },
    ledger_overrides: { section: 's3', label: 'แก้ยอดยกมา/รับเข้า', idField: 'id', idPrefix: 'LOV', columns: ['id', 'kind', 'itemKey', 'monthKey', 'value', 'lastUpdated'], numericFields: ['value'], trash: false },

    ot_requests: { section: 's4', label: 'งานนอกเวลา (OT)', idField: 'id', idPrefix: 'OT', columns: ['id', 'staffName', 'requestDate', 'workDate', 'reason', 'requestedHours', 'status', 'approverName', 'approvedDate', 'performedHours', 'reportDate', 'reportNote', 'lastUpdated', 'no', 'team', 'time', 'amount'], numericFields: ['amount', 'requestedHours', 'performedHours'] },
    budget_allocations: { section: 's4', label: 'งบประมาณ', idField: 'id', idPrefix: 'BUD', columns: ['id', 'fiscalYear', 'category', 'allocatedAmount', 'lastUpdated'], numericFields: ['fiscalYear', 'allocatedAmount'] },
    utility_bills: { section: 's4', label: 'ค่าสาธารณูปโภค', idField: 'id', idPrefix: 'UTL', columns: ['id', 'cycle', 'billType', 'billAmount', 'dueDate', 'reportedToDistrict', 'paidDate', 'note', 'lastUpdated', 'status'], numericFields: ['billAmount'] },
    water_meter_log: { section: 's4', label: 'มิเตอร์น้ำประปา', idField: 'id', idPrefix: 'WTR', columns: ['id', 'cycle', 'mainReading', 'subAReading', 'subBReading', 'billAmount', 'paidDateA', 'paidDateB', 'usageOverrideA', 'usageOverrideB', 'note', 'lastUpdated'], numericFields: ['mainReading', 'subAReading', 'subBReading', 'billAmount', 'usageOverrideA', 'usageOverrideB'] }
  };
  // ตารางที่ระบบรองที่ 2 เขียนข้ามไปได้ด้วย (ใบสั่งการรายวันตัดวัสดุ/น้ำมันจากคลังของระบบที่ 3)
  const CROSS_WRITE = { material_transactions: ['s2'], fuel_transactions: ['s2'] };
  FBL.TABLES = TABLES;

  /* ======================================================================
     สถานะเริ่มต้น / ตรวจค่า config
     ====================================================================== */
  FBL.configured = !/^YOUR_/.test(String(firebaseConfig.apiKey || '')) && !/^YOUR_/.test(String(firebaseConfig.projectId || ''));
  FBL.user = null;      // { uid, username, name, position, photo, role, sections, perm }
  let readyResolve;
  FBL.ready = new Promise(function (r) { readyResolve = r; });

  /* ---------- ข้อความผิดพลาดภาษาไทย ---------- */
  function thErr(e) {
    const code = (e && e.code) || '';
    const map = {
      'auth/invalid-credential': 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',
      'auth/wrong-password': 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',
      'auth/invalid-login-credentials': 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',
      'auth/user-not-found': 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',
      'auth/too-many-requests': 'ลองผิดหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่',
      'auth/network-request-failed': 'เชื่อมต่ออินเทอร์เน็ตไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่',
      'auth/weak-password': 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร',
      'auth/email-already-in-use': 'เกิดบัญชีซ้ำโดยบังเอิญ กรุณาลองอีกครั้ง',
      'auth/requires-recent-login': 'กรุณาออกจากระบบแล้วเข้าสู่ระบบใหม่ก่อนเปลี่ยนรหัสผ่าน',
      'auth/operation-not-allowed': 'ยังไม่ได้เปิดการเข้าสู่ระบบแบบ Email/Password ใน Firebase Console',
      'auth/unauthorized-domain': 'โดเมนนี้ยังไม่ได้รับอนุญาตใน Firebase (Authentication → Settings → Authorized domains)',
      'permission-denied': 'ไม่มีสิทธิ์ทำรายการนี้ (ตรวจสอบว่าวางกฎ firestore.rules แล้ว และบัญชีนี้มีสิทธิ์แก้ไขระบบนี้)',
      'unavailable': 'เชื่อมต่อฐานข้อมูลไม่ได้ในขณะนี้ กรุณาลองใหม่',
      'failed-precondition': 'ฐานข้อมูลไม่พร้อมทำรายการนี้',
      'resource-exhausted': 'ใช้งานฐานข้อมูลเกินโควตาฟรีของวันนี้แล้ว (แผน Spark) กรุณาลองใหม่พรุ่งนี้ หรือติดต่อเจ้าของระบบ'
    };
    return map[code] || ((e && e.message) ? e.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ');
  }
  FBL.errorText = thErr;

  function nowIso() { return new Date().toISOString(); }
  function randomId(n) {
    const bytes = crypto.getRandomValues(new Uint8Array(n));
    return Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('').slice(0, n);
  }
  function newEmail() { return 'u-' + randomId(12) + '@' + EMAIL_DOMAIN; }
  function clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  FBL.esc = esc;
  // ชื่อผู้ใช้: ตัวพิมพ์เล็ก ไม่มีช่องว่างหัวท้าย (ใช้เป็นรหัสเอกสาร login_directory)
  function normUsername(u) { return String(u || '').trim().toLowerCase(); }
  // รหัสเอกสาร Firestore ห้ามมี "/" และห้ามเป็น "." / ".." — แปลงเฉพาะอักขระที่มีปัญหา ค่าเดิมยังเก็บในฟิลด์ id ของแถวเสมอ
  function docKey(v) {
    let s = String(v == null ? '' : v).replace(/%/g, '%25').replace(/\//g, '%2F');
    if (s === '.' || s === '..') s = s.replace(/\./g, '%2E');
    if (/^__.*__$/.test(s)) s = '%5F' + s.slice(1);
    return s;
  }
  FBL.docKey = docKey;

  /* ======================================================================
     ส่วนแสดงผลที่ไฟล์นี้ฉีดเข้าไปในทุกหน้า: หน้าล็อกอิน / ไม่มีสิทธิ์ / ยังไม่ตั้งค่า / แจ้งข้อมูลอัปเดต
     ====================================================================== */
  const CSS = `
  .fbl-gate{position:fixed;inset:0;z-index:5000;display:flex;align-items:center;justify-content:center;padding:18px;overflow:auto;background:radial-gradient(1100px 520px at 15% -10%,#4b5563 0%,#111827 60%);font-family:'Sarabun',sans-serif}
  .fbl-gate.hidden{display:none}
  .fbl-card{background:#fff;border-radius:18px;padding:30px 28px 26px;width:100%;max-width:410px;box-shadow:0 16px 40px -14px rgba(0,0,0,.45);text-align:center;font-size:15px;line-height:1.55;color:#182430}
  .fbl-logo{display:block;width:72px;height:72px;margin:0 auto 6px;border-radius:50%;object-fit:cover}
  .fbl-title{font-family:'Kanit',sans-serif;font-weight:700;font-size:22px;color:#111827;margin:4px 0 2px}
  .fbl-sub{font-size:13px;color:#8792a0;margin:0 0 18px}
  .fbl-head{font-family:'Kanit',sans-serif;font-weight:700;font-size:16px;margin:0 0 12px;text-align:left}
  .fbl-field{margin-bottom:12px;text-align:left;position:relative}
  .fbl-label{display:block;font-size:12.5px;font-weight:600;color:#4d5a66;margin:0 0 5px}
  .fbl-input{width:100%;box-sizing:border-box;padding:8px 36px 8px 10px;border:1px solid #dfe2dd;border-radius:8px;background:#fff;font-family:'Sarabun',sans-serif;font-size:14.5px;color:#182430;outline:none}
  .fbl-input:focus{border-color:#f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,.18)}
  .fbl-eye{position:absolute;right:4px;bottom:5px;background:none;border:none;cursor:pointer;padding:4px 8px;color:#4d5a66;font-size:14px}
  .fbl-btn{display:flex;align-items:center;justify-content:center;width:100%;padding:10px 17px;border:none;border-radius:10px;background:linear-gradient(135deg,#fbbf24,#f59e0b);color:#1f2937;font-family:'Kanit',sans-serif;font-weight:600;font-size:14.5px;cursor:pointer;box-shadow:0 4px 12px -2px rgba(245,158,11,.4)}
  .fbl-btn:disabled{opacity:.7;cursor:wait}
  .fbl-btn.ghost{background:#fff;border:1px solid #dfe2dd;box-shadow:none;color:#182430;margin-top:8px}
  .fbl-err{color:#c1402f;font-size:13px;margin:4px 0 10px;text-align:left;min-height:0}
  .fbl-note{font-size:12.5px;color:#4d5a66;text-align:left;background:#f5f6f4;border-radius:10px;padding:10px 12px;margin:0 0 14px;line-height:1.6}
  .fbl-dd{position:absolute;top:calc(100% + 4px);left:0;right:0;background:#fff;border:1px solid #dfe2dd;border-radius:10px;box-shadow:0 12px 26px -8px rgba(7,27,48,.28);max-height:220px;overflow-y:auto;z-index:10;text-align:left}
  .fbl-dd.hidden{display:none}
  .fbl-opt{padding:9px 13px;font-size:13.5px;cursor:pointer}
  .fbl-opt:hover{background:#f5f6f4}
  .fbl-opt small{color:#8792a0;margin-left:6px}
  .fbl-links{display:flex;flex-direction:column;gap:8px;margin-top:12px}
  .fbl-links a{display:block;padding:9px 12px;border:1px solid #dfe2dd;border-radius:10px;color:#123a5e;text-decoration:none;font-weight:600;font-size:14px}
  .fbl-links a:hover{border-color:#f59e0b;background:#fffbeb}
  .fbl-banner{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:4000;background:#0a2540;color:#fff;border-radius:12px;padding:10px 12px 10px 16px;display:flex;align-items:center;gap:12px;font-family:'Sarabun',sans-serif;font-size:13.5px;box-shadow:0 16px 34px -12px rgba(7,27,48,.55);max-width:calc(100% - 32px)}
  .fbl-banner.hidden{display:none}
  .fbl-banner button{border:none;border-radius:8px;padding:6px 12px;font-family:'Kanit',sans-serif;font-weight:600;font-size:13px;cursor:pointer}
  .fbl-banner .go{background:#f59e0b;color:#1f2937}
  .fbl-banner .x{background:transparent;color:#a9bbcc;padding:6px 8px}
  .fbl-toast{position:fixed;top:18px;right:18px;z-index:6000;background:#c1402f;color:#fff;border-radius:10px;padding:11px 16px;font-family:'Sarabun',sans-serif;font-size:13.5px;box-shadow:0 14px 34px -12px rgba(7,27,48,.5);max-width:360px}
  .fbl-role-chip{display:inline-block;font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;background:#eef3f8;color:#123a5e;margin-top:4px}
  `;

  function logoSrc() { return 'logo.jpg'; }

  function injectBase() {
    if (document.getElementById('fbl-style')) return;
    const st = document.createElement('style');
    st.id = 'fbl-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  let gateEl = null;
  function ensureGate() {
    injectBase();
    if (gateEl) return gateEl;
    gateEl = document.createElement('div');
    gateEl.className = 'fbl-gate hidden';
    gateEl.id = 'fbl-gate';
    gateEl.innerHTML = '<div class="fbl-card" id="fbl-card"></div>';
    (document.body || document.documentElement).appendChild(gateEl);
    return gateEl;
  }
  function gateCard(html) {
    ensureGate();
    document.getElementById('fbl-card').innerHTML =
      '<img class="fbl-logo" src="' + logoSrc() + '" alt="ตรากรมทางหลวง">' +
      '<div class="fbl-title">งานบริหารหมวด</div>' +
      '<div class="fbl-sub">หมวดทางหลวงเชิงเนิน · แขวงทางหลวงระยอง</div>' + html;
    gateEl.classList.remove('hidden');
  }
  function hideGate() { if (gateEl) gateEl.classList.add('hidden'); }
  FBL.hideGate = hideGate;

  function showToast(msg, ms) {
    injectBase();
    const t = document.createElement('div');
    t.className = 'fbl-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, ms || 5000);
  }
  FBL.toast = showToast;

  function pwToggleHtml(id) {
    return '<button type="button" class="fbl-eye" onclick="(function(b){var i=document.getElementById(\'' + id + '\');i.type=i.type===\'password\'?\'text\':\'password\';b.textContent=i.type===\'password\'?\'👁\':\'🙈\';})(this)">👁</button>';
  }

  function showNotConfigured() {
    gateCard(
      '<div class="fbl-head">ยังไม่ได้ตั้งค่า Firebase</div>' +
      '<div class="fbl-note">ไฟล์ <b>firebase-layer.js</b> ยังเป็นค่าตัวอย่าง (YOUR_...) — ให้ทำตาม <b>คู่มือติดตั้ง-อ่านก่อน.md</b> ขั้นที่ 1-5 แล้วอัปโหลดไฟล์ใหม่</div>'
    );
  }

  let loginNames = null;   // [{username, name}]
  async function loadLoginNames() {
    if (loginNames) return loginNames;
    try {
      const snap = await db.collection('login_directory').get();
      loginNames = snap.docs.map(function (d) { return { username: d.id, name: d.data().name || '' }; })
        .sort(function (a, b) { return a.username.localeCompare(b.username); });
    } catch (e) { loginNames = []; }
    return loginNames;
  }

  async function showLogin(message) {
    let hasOwner = true;
    try { hasOwner = (await db.collection('config').doc('bootstrap').get()).exists; } catch (e) { /* ถือว่ามีแล้ว */ }
    if (!hasOwner) { showBootstrap(); return; }
    gateCard(
      '<div class="fbl-head">เข้าสู่ระบบ</div>' +
      (message ? '<div class="fbl-err">' + esc(message) + '</div>' : '') +
      '<div class="fbl-field"><label class="fbl-label" for="fbl-user">ชื่อผู้ใช้งาน</label>' +
      '<input class="fbl-input" id="fbl-user" autocomplete="username" placeholder="— พิมพ์หรือเลือกชื่อผู้ใช้ —">' +
      '<div class="fbl-dd hidden" id="fbl-dd"></div></div>' +
      '<div class="fbl-field"><label class="fbl-label" for="fbl-pass">รหัสผ่าน</label>' +
      '<input class="fbl-input" id="fbl-pass" type="password" autocomplete="current-password" placeholder="รหัสผ่าน">' + pwToggleHtml('fbl-pass') + '</div>' +
      '<div class="fbl-err" id="fbl-login-err"></div>' +
      '<button class="fbl-btn" id="fbl-login-btn">เข้าสู่ระบบ</button>'
    );
    const u = document.getElementById('fbl-user');
    const p = document.getElementById('fbl-pass');
    const dd = document.getElementById('fbl-dd');
    const btn = document.getElementById('fbl-login-btn');
    const names = await loadLoginNames();
    function renderDd() {
      const q = u.value.trim().toLowerCase();
      const list = names.filter(function (n) { return !q || n.username.indexOf(q) !== -1 || String(n.name).toLowerCase().indexOf(q) !== -1; });
      dd.innerHTML = list.length ? list.map(function (n) {
        return '<div class="fbl-opt" data-u="' + esc(n.username) + '">' + esc(n.username) + (n.name ? '<small>' + esc(n.name) + '</small>' : '') + '</div>';
      }).join('') : '<div class="fbl-opt" style="color:#8792a0;cursor:default">ไม่พบชื่อผู้ใช้</div>';
    }
    u.addEventListener('focus', function () { renderDd(); dd.classList.remove('hidden'); });
    u.addEventListener('input', function () { renderDd(); dd.classList.remove('hidden'); });
    u.addEventListener('blur', function () { setTimeout(function () { dd.classList.add('hidden'); }, 150); });
    dd.addEventListener('mousedown', function (e) {
      const opt = e.target.closest('[data-u]');
      if (!opt) return;
      e.preventDefault();
      u.value = opt.dataset.u;
      dd.classList.add('hidden');
      p.focus();
    });
    async function go() {
      const err = document.getElementById('fbl-login-err');
      err.textContent = '';
      if (!u.value.trim() || !p.value) { err.textContent = 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน'; return; }
      btn.disabled = true; btn.textContent = 'กำลังตรวจสอบ...';
      try {
        await FBL.login(u.value, p.value);
        // onAuthStateChanged จะจัดการต่อ (โหลดสิทธิ์แล้วรีเฟรชหน้า)
      } catch (e) {
        err.textContent = e.message;
        btn.disabled = false; btn.textContent = 'เข้าสู่ระบบ';
        p.value = ''; p.focus();
      }
    }
    btn.onclick = go;
    p.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    u.addEventListener('keydown', function (e) { if (e.key === 'Enter') { dd.classList.add('hidden'); p.focus(); } });
    setTimeout(function () { u.focus(); }, 50);
  }

  function showBootstrap() {
    gateCard(
      '<div class="fbl-head">ตั้งค่าเจ้าของระบบครั้งแรก</div>' +
      '<div class="fbl-note">ยังไม่มีเจ้าของระบบ — ผู้ที่ตั้งค่าตรงนี้คนแรกจะเป็น <b>เจ้าของระบบ</b> (สิทธิ์เต็ม + จัดการผู้ใช้งาน) และประตูนี้จะปิดถาวรทันทีหลังตั้งค่าเสร็จ</div>' +
      '<div class="fbl-field"><label class="fbl-label">ชื่อ-นามสกุล</label><input class="fbl-input" id="fbl-b-name" placeholder="เช่น นางสาวนันท์นภัสธ์ รัตนเสถียร"></div>' +
      '<div class="fbl-field"><label class="fbl-label">ตำแหน่ง</label><input class="fbl-input" id="fbl-b-pos" placeholder="เช่น ผช.ม.เชิงเนิน"></div>' +
      '<div class="fbl-field"><label class="fbl-label">ชื่อผู้ใช้ (ภาษาอังกฤษ/ตัวเลข ใช้ตอนล็อกอิน)</label><input class="fbl-input" id="fbl-b-user" autocomplete="off"></div>' +
      '<div class="fbl-field"><label class="fbl-label">ตั้งรหัสผ่าน (อย่างน้อย 6 ตัวอักษร)</label><input class="fbl-input" id="fbl-b-pass" type="password" autocomplete="new-password">' + pwToggleHtml('fbl-b-pass') + '</div>' +
      '<div class="fbl-err" id="fbl-b-err"></div>' +
      '<button class="fbl-btn" id="fbl-b-btn">ตั้งให้ฉันเป็นเจ้าของระบบ</button>'
    );
    document.getElementById('fbl-b-btn').onclick = async function () {
      const btn = this;
      const err = document.getElementById('fbl-b-err');
      err.textContent = '';
      btn.disabled = true; btn.textContent = 'กำลังตั้งค่า...';
      try {
        await FBL.bootstrapOwner({
          name: document.getElementById('fbl-b-name').value,
          position: document.getElementById('fbl-b-pos').value,
          username: document.getElementById('fbl-b-user').value,
          password: document.getElementById('fbl-b-pass').value
        });
        location.reload();
      } catch (e) {
        err.textContent = e.message;
        btn.disabled = false; btn.textContent = 'ตั้งให้ฉันเป็นเจ้าของระบบ';
      }
    };
  }

  function allowedPages(user) {
    const out = [];
    if (user.perm.main) out.push('main');
    SUB_KEYS.forEach(function (k) { if (user.perm[k] !== 'none') out.push(k); });
    return out;
  }
  FBL.allowedPages = function () { return FBL.user ? allowedPages(FBL.user) : []; };

  function showDenied() {
    const pages = allowedPages(FBL.user);
    gateCard(
      '<div class="fbl-head">ไม่มีสิทธิ์เข้าถึงหน้านี้</div>' +
      '<div class="fbl-note">บัญชี <b>' + esc(FBL.user.name) + '</b> (' + esc(ROLES[FBL.user.role] ? ROLES[FBL.user.role].label : FBL.user.role) + ') ไม่ได้รับสิทธิ์ใช้งาน "' + esc(SECTIONS[FBL.page].label) + '" — ติดต่อเจ้าของระบบหากต้องการสิทธิ์เพิ่ม</div>' +
      (pages.length ? '<div class="fbl-links">' + pages.map(function (k) { return '<a href="' + SECTIONS[k].file + '">' + (k === 'main' ? '• ' : k.slice(1) + '. ') + esc(SECTIONS[k].label) + '</a>'; }).join('') + '</div>'
        : '<div class="fbl-note">บัญชีนี้ยังไม่ได้รับสิทธิ์ระบบใดเลย</div>') +
      '<button class="fbl-btn ghost" id="fbl-deny-out">ออกจากระบบ</button>'
    );
    document.getElementById('fbl-deny-out').onclick = function () { FBL.logout(); };
  }

  // ซ่อนลิงก์ในแถบข้างของหน้าที่ผู้ใช้ไม่มีสิทธิ์ (ลิงก์ .nav-item ที่ชี้ไปไฟล์ choengnoenX-...)
  function applyNav(user) {
    const pages = allowedPages(user);
    document.querySelectorAll('a.nav-item').forEach(function (a) {
      const href = a.getAttribute('href') || '';
      let key = null;
      Object.keys(SECTIONS).forEach(function (k) { if (href.indexOf(SECTIONS[k].file) !== -1) key = k; });
      if (!key && a.classList.contains('active')) key = FBL.page;
      if (!key) return;
      a.style.display = pages.indexOf(key) === -1 ? 'none' : '';
    });
    // หัวข้อกลุ่ม "ระบบหลัก" ซ่อนตามลิงก์ระบบหลัก
    const mainAllowed = pages.indexOf('main') !== -1;
    ['nav-group-main', 'nav-main-link'].forEach(function (id) { const el = document.getElementById(id); if (el) el.style.display = mainAllowed ? '' : 'none'; });
    document.querySelectorAll('.nav-group-label').forEach(function (el) {
      if (/ระบบหลัก/.test(el.textContent)) el.style.display = mainAllowed ? '' : 'none';
    });
  }
  FBL.applyNav = function () { if (FBL.user) applyNav(FBL.user); };

  // แถบแจ้งว่ามีข้อมูลใหม่จากผู้ใช้อื่น (หน้าเว็บเดิมไม่ได้ออกแบบให้วาดใหม่เองอัตโนมัติ จึงให้ผู้ใช้กดรีเฟรชเอง)
  let bannerEl = null;
  let bannerMuteUntil = 0;
  FBL.onRemoteChange = null; // หน้าที่รองรับวาดใหม่เอง (ระบบหลัก) ตั้ง callback นี้ได้ แทนการแสดงแถบ
  function notifyRemoteChange(table) {
    if (typeof FBL.onRemoteChange === 'function') { try { FBL.onRemoteChange(table); } catch (e) { console.error(e); } return; }
    if (Date.now() < bannerMuteUntil) return;
    injectBase();
    if (!bannerEl) {
      bannerEl = document.createElement('div');
      bannerEl.className = 'fbl-banner hidden';
      bannerEl.innerHTML = '<span>🔄 มีผู้ใช้อื่นอัปเดตข้อมูล — โหลดหน้าใหม่เพื่อดูข้อมูลล่าสุด</span><button class="go">โหลดใหม่</button><button class="x" title="ปิด">✕</button>';
      document.body.appendChild(bannerEl);
      bannerEl.querySelector('.go').onclick = function () { location.reload(); };
      bannerEl.querySelector('.x').onclick = function () { bannerEl.classList.add('hidden'); bannerMuteUntil = Date.now() + 5 * 60000; };
    }
    bannerEl.classList.remove('hidden');
  }

  /* ======================================================================
     ถ้ายังไม่ตั้งค่า Firebase — แสดงข้อความแทน ไม่ทำให้หน้าพัง (apiGet คืนค่าว่าง)
     ====================================================================== */
  if (!FBL.configured) {
    FBL.apiGet = async function () { return []; };
    FBL.apiGetMultiple = async function (ts) { const o = {}; (ts || []).forEach(function (t) { o[t] = []; }); return o; };
    FBL.apiPost = async function () { throw new Error('ยังไม่ได้ตั้งค่า Firebase'); };
    FBL.canEdit = function () { return false; };
    FBL.can = function () { return false; };
    FBL.legacySession = function () { return null; };
    FBL.logout = async function () { };
    FBL.stateGet = async function () { return {}; };
    FBL.stateSet = async function () { };
    FBL.rows = function () { return []; };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showNotConfigured); else showNotConfigured();
    return;
  }

  /* ======================================================================
     เริ่ม Firebase
     ====================================================================== */
  firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();
  // ค่า undefined ในข้อมูล (หน้าเว็บเดิมบางจุดส่งมา) ให้ข้ามไปเฉยๆ แทนที่จะทำให้บันทึกล้มเหลวทั้งคำสั่ง
  try { if (db.settings) db.settings({ ignoreUndefinedProperties: true, merge: true }); } catch (e) { /* ข้าม */ }
  try {
    db.enablePersistence({ synchronizeTabs: true }).catch(function (e) { console.warn('Firestore offline cache unavailable:', e && e.code); });
  } catch (e) { /* เบราว์เซอร์ที่ไม่รองรับ — ทำงานต่อแบบไม่มีแคช */ }
  FBL.db = db;

  /* ---------- สิทธิ์ ---------- */
  function sectionOf(table) { return TABLES[table] ? TABLES[table].section : null; }
  FBL.isOwner = function () { return !!(FBL.user && FBL.user.role === 'owner'); };
  FBL.perm = function () { return FBL.user ? FBL.user.perm : presetPerm('none'); };
  // แก้ไขข้อมูลในระบบ sec ได้ไหม (sec = 's1'..'s4')
  FBL.canEdit = function (sec) { return !!(FBL.user && (FBL.user.role === 'owner' || FBL.user.perm[sec || FBL.page] === 'edit')); };
  FBL.canView = function (sec) { return !!(FBL.user && (FBL.user.role === 'owner' || (sec === 'main' ? FBL.user.perm.main : FBL.user.perm[sec] !== 'none'))); };
  // สิทธิ์พิเศษ: delete / restore / purge / viewLog / unlockLedger / export
  FBL.can = function (flag) { return !!(FBL.user && (FBL.user.role === 'owner' || FBL.user.perm[flag] === true)); };
  function canWriteTable(table) {
    const sec = sectionOf(table);
    if (!sec) return false;
    if (FBL.canEdit(sec)) return true;
    return (CROSS_WRITE[table] || []).some(function (s) { return FBL.canEdit(s); });
  }
  FBL.canWriteTable = canWriteTable;
  function canDeleteRow(table) {
    if (!canWriteTable(table)) return false;
    if (table === 'ledger_locks') return FBL.can('unlockLedger');
    if (TABLES[table].trash === false || CROSS_WRITE[table]) return true; // ข้อมูลเชิงเทคนิค/รายการลูก — ผู้แก้ไขลบได้เสมอ
    return FBL.can('delete');
  }
  FBL.canDeleteRow = canDeleteRow;

  // ป้ายบทบาท + สิทธิ์ในหน้านี้ (แสดงในเมนูผู้ใช้มุมขวาบน)
  FBL.permBadgeHtml = function () {
    if (!FBL.user) return '';
    const r = ROLES[FBL.user.role] || ROLES.staff;
    let access = '';
    if (FBL.page === 'main') access = 'ระบบหลัก';
    else access = FBL.canEdit(FBL.page) ? 'แก้ไขได้' : 'ดูอย่างเดียว';
    return '<span class="fbl-role-chip">' + r.icon + ' ' + esc(r.label) + ' · ' + access + '</span>';
  };

  // เปลี่ยนรหัสผ่านของตัวเอง (หน้าต่างเล็กจากเมนูผู้ใช้ — ใช้ได้ทุกหน้า)
  FBL.openChangePassword = function () {
    injectBase();
    const wrap = document.createElement('div');
    wrap.className = 'fbl-gate';
    wrap.style.background = 'rgba(7,27,48,.6)';
    wrap.innerHTML = '<div class="fbl-card" style="max-width:380px">' +
      '<div class="fbl-head">เปลี่ยนรหัสผ่านของฉัน</div>' +
      '<div class="fbl-field"><label class="fbl-label">รหัสผ่านใหม่ (อย่างน้อย 6 ตัวอักษร)</label><input class="fbl-input" id="fbl-cp-1" type="password" autocomplete="new-password">' + pwToggleHtml('fbl-cp-1') + '</div>' +
      '<div class="fbl-field"><label class="fbl-label">ยืนยันรหัสผ่านใหม่</label><input class="fbl-input" id="fbl-cp-2" type="password" autocomplete="new-password"></div>' +
      '<div class="fbl-err" id="fbl-cp-err"></div>' +
      '<button class="fbl-btn" id="fbl-cp-ok">บันทึกรหัสผ่านใหม่</button>' +
      '<button class="fbl-btn ghost" id="fbl-cp-cancel">ยกเลิก</button></div>';
    document.body.appendChild(wrap);
    const close = function () { wrap.remove(); };
    wrap.querySelector('#fbl-cp-cancel').onclick = close;
    wrap.querySelector('#fbl-cp-ok').onclick = async function () {
      const a = wrap.querySelector('#fbl-cp-1').value, b = wrap.querySelector('#fbl-cp-2').value;
      const err = wrap.querySelector('#fbl-cp-err');
      if (a.length < 6) { err.textContent = 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร'; return; }
      if (a !== b) { err.textContent = 'รหัสผ่านสองช่องไม่ตรงกัน'; return; }
      this.disabled = true; this.textContent = 'กำลังบันทึก...';
      try { await FBL.changeMyPassword(a); close(); alert('เปลี่ยนรหัสผ่านเรียบร้อยแล้ว'); }
      catch (e) { err.textContent = e.message; this.disabled = false; this.textContent = 'บันทึกรหัสผ่านใหม่'; }
    };
    setTimeout(function () { wrap.querySelector('#fbl-cp-1').focus(); }, 30);
  };
  // เพิ่มปุ่ม "เปลี่ยนรหัสผ่าน" ในเมนูผู้ใช้ของทุกหน้า (ก่อนปุ่มออกจากระบบ)
  function injectUserMenu() {
    const out = document.getElementById('logout-btn');
    if (!out || document.getElementById('fbl-chpw-btn')) return;
    const b = document.createElement('button');
    b.id = 'fbl-chpw-btn';
    b.type = 'button';
    b.className = out.className.replace(/\bdanger\b/, '').trim();
    b.textContent = '🔑 เปลี่ยนรหัสผ่าน';
    b.onclick = function (e) { e.stopPropagation(); const p = document.getElementById('user-menu-panel'); if (p) p.classList.add('hidden'); FBL.openChangePassword(); };
    out.parentNode.insertBefore(b, out);
    out.style.display = 'flex';
  }

  // ข้อมูลผู้ใช้ในรูปแบบ session เดิม ที่หน้าเว็บเก่าใช้วาดรูปโปรไฟล์/ชื่อบนแถบบน
  FBL.legacySession = function () {
    if (!FBL.user) return null;
    return { role: 'admin', appRole: FBL.user.role, name: FBL.user.name, position: FBL.user.position || '', photo: FBL.user.photo || null, username: FBL.user.username };
  };
  function writeLegacySession() {
    try {
      if (FBL.user) localStorage.setItem(LEGACY_SESSION_KEY, JSON.stringify(Object.assign(FBL.legacySession(), { ts: Date.now() })));
      else localStorage.removeItem(LEGACY_SESSION_KEY);
    } catch (e) { /* ข้าม */ }
  }

  /* ---------- โปรไฟล์ในแคช (ให้หน้าเปิดได้ทันที) ---------- */
  function readCachedProfile() {
    try { const p = JSON.parse(localStorage.getItem(PROFILE_CACHE_KEY) || 'null'); return p && p.uid ? p : null; } catch (e) { return null; }
  }
  function writeCachedProfile(u) {
    try { if (u) localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(u)); else localStorage.removeItem(PROFILE_CACHE_KEY); } catch (e) { /* ข้าม */ }
  }
  function profileSignature(u) { return u ? JSON.stringify([u.uid, u.role, u.perm, u.name, u.position, u.photo, u.active]) : ''; }

  function userFromTeamDoc(uid, d) {
    return {
      uid: uid,
      username: d.username || '',
      name: d.name || '',
      position: d.position || '',
      photo: d.photo || null,
      role: d.role || 'staff',
      sections: Array.isArray(d.sections) ? d.sections : [],
      perm: normalizePerm(d.perm, d.role),
      active: d.active !== false
    };
  }

  // ทางลัด: ถ้ามีโปรไฟล์ในแคช ให้ถือว่าล็อกอินอยู่ทันที (หน้าเว็บวาดได้เลย) แล้วค่อยยืนยันกับเซิร์ฟเวอร์ภายหลัง
  const cached = readCachedProfile();
  let startedWith = null;
  if (cached) {
    FBL.user = cached;
    startedWith = profileSignature(cached);
    writeLegacySession();
    const pageOk = FBL.canView(FBL.page);
    if (!pageOk && FBL.page === 'main') {
      // ผู้ไม่มีสิทธิ์ระบบหลัก → ส่งไปหน้าระบบรองหน้าแรกที่เปิดได้ทันที (ก่อนหน้าวาดอะไรขึ้นมา)
      // เลือกระบบที่ตัวเองแก้ไขได้ก่อน (ส่วนงานที่รับผิดชอบ) ถ้าไม่มีจึงไประบบแรกที่ดูได้
      const subPages = allowedPages(cached).filter(function (k) { return k !== 'main'; });
      const first = subPages.filter(function (k) { return cached.perm[k] === 'edit'; })[0] || subPages[0];
      if (first) location.replace(SECTIONS[first].file);
    }
  }

  function onDomReady(fn) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }

  onDomReady(function () {
    injectBase();
    if (!FBL.user) ensureGate(); // ยังไม่มีแคช → ปิดหน้าไว้ก่อนระหว่างรอตรวจสถานะล็อกอิน
    if (!FBL.user) gateCard('<div class="fbl-note" style="text-align:center">กำลังตรวจสอบการเข้าสู่ระบบ...</div>');
    else if (!FBL.canView(FBL.page)) showDenied();
    else { applyNav(FBL.user); injectUserMenu(); }
  });

  let suppressAuthEvents = false;
  auth.onAuthStateChanged(async function (u) {
    if (suppressAuthEvents) return;
    if (!u) {
      const hadUser = !!FBL.user;
      FBL.user = null;
      writeCachedProfile(null);
      writeLegacySession();
      if (hadUser && cached) { location.reload(); return; } // แคชเก่าแต่หลุดล็อกอินแล้ว → เริ่มใหม่ให้สะอาด
      onDomReady(function () { showLogin(); });
      return;
    }
    try {
      let d = null;
      try { d = await db.collection('team').doc(u.uid).get({ source: 'server' }); }
      catch (e) { d = await db.collection('team').doc(u.uid).get(); } // ออฟไลน์ → ใช้แคช
      if (!d.exists || d.data().active === false) {
        await auth.signOut();
        FBL.user = null; writeCachedProfile(null); writeLegacySession();
        onDomReady(function () { showLogin(d.exists ? 'บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อเจ้าของระบบ' : 'บัญชีนี้ไม่ได้อยู่ในรายชื่อผู้ใช้งาน กรุณาติดต่อเจ้าของระบบ'); });
        return;
      }
      const user = userFromTeamDoc(u.uid, d.data());
      FBL.user = user;
      writeCachedProfile(user);
      writeLegacySession();
      if (!startedWith || startedWith !== profileSignature(user)) {
        // ล็อกอินใหม่ หรือสิทธิ์/ข้อมูลผู้ใช้เปลี่ยนตั้งแต่ครั้งก่อน → รีเฟรชให้หน้าเว็บวาดใหม่ด้วยสิทธิ์ที่ถูกต้อง
        location.reload();
        return;
      }
      readyResolve(user);
      onDomReady(function () {
        if (!FBL.canView(FBL.page)) { showDenied(); return; }
        hideGate();
        applyNav(user);
      });
      startPresence();
    } catch (e) {
      onDomReady(function () { showLogin(thErr(e)); });
    }
  });

  /* ---------- ล็อกอิน / ออกจากระบบ ---------- */
  FBL.login = async function (username, password) {
    const un = normUsername(username);
    let dir;
    try { dir = await db.collection('login_directory').doc(docKey(un)).get(); }
    catch (e) { throw new Error(thErr(e)); }
    if (!dir.exists) throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    try { await auth.signInWithEmailAndPassword(dir.data().email, password); }
    catch (e) { throw new Error(thErr(e)); }
  };

  FBL.logout = async function () {
    try { await Promise.race([presenceWrite(false), new Promise(function (r) { setTimeout(r, 2000); })]); } catch (e) { /* ข้าม */ }
    stopPresence();
    writeCachedProfile(null);
    FBL.user = null;
    writeLegacySession();
    try { await auth.signOut(); } catch (e) { /* ข้าม */ }
    location.reload();
  };

  // เปลี่ยนรหัสผ่านของตัวเอง
  FBL.changeMyPassword = async function (newPassword) {
    if (!auth.currentUser) throw new Error('ยังไม่ได้เข้าสู่ระบบ');
    try { await auth.currentUser.updatePassword(newPassword); } catch (e) { throw new Error(thErr(e)); }
  };

  // ตั้งเจ้าของระบบคนแรก — Rules อนุญาตเฉพาะตอนที่ยังไม่มีเอกสาร config/bootstrap
  FBL.bootstrapOwner = async function (o) {
    const name = String(o.name || '').trim();
    const username = normUsername(o.username);
    if (!name) throw new Error('กรอกชื่อ-นามสกุลก่อน');
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw new Error('ชื่อผู้ใช้ต้องเป็นภาษาอังกฤษตัวเล็ก/ตัวเลข/จุด/ขีด 3-30 ตัว');
    suppressAuthEvents = true;
    try {
      const email = newEmail();
      const cred = await auth.createUserWithEmailAndPassword(email, o.password);
      const uid = cred.user.uid;
      try {
        const batch = db.batch();
        batch.set(db.collection('team').doc(uid), {
          username: username, name: name, position: String(o.position || '').trim(), email: email, photo: null,
          role: 'owner', sections: [], perm: presetPerm('owner'), active: true, createdAt: nowIso(), updatedAt: nowIso()
        });
        batch.set(db.collection('login_directory').doc(docKey(username)), { email: email, uid: uid, name: name });
        batch.set(db.collection('config').doc('bootstrap'), { uid: uid, at: nowIso() });
        await batch.commit();
      } catch (e) {
        try { await cred.user.delete(); } catch (_) { /* ล้างบัญชีที่ค้าง */ }
        throw e;
      }
    } catch (e) {
      throw new Error(thErr(e));
    } finally {
      suppressAuthEvents = false;
    }
  };

  /* ======================================================================
     จัดการผู้ใช้งาน (เจ้าของระบบเท่านั้น — บังคับที่ Rules)
     ====================================================================== */
  function requireOwner() { if (!FBL.isOwner()) throw new Error('เฉพาะเจ้าของระบบเท่านั้น'); }

  // สร้างบัญชี Auth โดยไม่ทำให้เจ้าของระบบหลุดจากเซสชัน (ใช้แอปรองแยกต่างหาก)
  async function createAuthUserSecondary(email, password) {
    const sec = firebase.apps.find(function (a) { return a.name === 'secondary'; }) || firebase.initializeApp(firebaseConfig, 'secondary');
    const cred = await sec.auth().createUserWithEmailAndPassword(email, password);
    const uid = cred.user.uid;
    await sec.auth().signOut();
    return uid;
  }

  FBL.listTeam = async function () {
    const snap = await db.collection('team').get();
    return snap.docs.map(function (d) { return Object.assign(userFromTeamDoc(d.id, d.data()), { createdAt: d.data().createdAt || '' }); })
      .sort(function (a, b) {
        const order = { owner: 0, chief: 1, assistant: 2, staff: 3 };
        return (order[a.role] - order[b.role]) || String(a.name).localeCompare(String(b.name), 'th');
      });
  };
  FBL.watchTeam = function (cb) {
    return db.collection('team').onSnapshot(function (snap) {
      cb(snap.docs.map(function (d) { return userFromTeamDoc(d.id, d.data()); }));
    }, function (err) { console.warn('watch team failed', err && err.code); });
  };

  // o = { username, password, name, position, role, sections, perm, photo }
  FBL.addMember = async function (o) {
    requireOwner();
    const username = normUsername(o.username);
    const name = String(o.name || '').trim();
    if (!name) throw new Error('กรอกชื่อ-นามสกุลก่อน');
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw new Error('ชื่อผู้ใช้ต้องเป็นภาษาอังกฤษตัวเล็ก/ตัวเลข/จุด/ขีด 3-30 ตัว');
    if (o.role === 'owner') throw new Error('เจ้าของระบบมีได้คนเดียว');
    const exists = await db.collection('login_directory').doc(docKey(username)).get();
    if (exists.exists) throw new Error('มีชื่อผู้ใช้ "' + username + '" อยู่แล้ว');
    try {
      const email = newEmail();
      const uid = await createAuthUserSecondary(email, o.password);
      const batch = db.batch();
      batch.set(db.collection('team').doc(uid), {
        username: username, name: name, position: String(o.position || '').trim(), email: email, photo: o.photo || null,
        role: o.role || 'staff', sections: o.sections || [], perm: normalizePerm(o.perm || presetPerm(o.role, o.sections), o.role),
        active: true, createdAt: nowIso(), updatedAt: nowIso()
      });
      batch.set(db.collection('login_directory').doc(docKey(username)), { email: email, uid: uid, name: name });
      batch.set(logRef(), logEntry('add', 'team', username, 'เพิ่มผู้ใช้งาน ' + name + ' (' + (ROLES[o.role] || ROLES.staff).label + ')'));
      await batch.commit();
      loginNames = null;
    } catch (e) { throw new Error(thErr(e)); }
  };

  // แก้ข้อมูล/บทบาท/สิทธิ์/ระงับการใช้งาน — o = { name, position, role, sections, perm, photo, active }
  FBL.updateMember = async function (uid, o) {
    requireOwner();
    const ref = db.collection('team').doc(uid);
    const cur = await ref.get();
    if (!cur.exists) throw new Error('ไม่พบผู้ใช้นี้');
    const c = cur.data();
    const isOwnerDoc = c.role === 'owner';
    const role = isOwnerDoc ? 'owner' : (o.role || c.role);
    if (!isOwnerDoc && role === 'owner') throw new Error('เจ้าของระบบมีได้คนเดียว');
    const patch = {
      name: o.name !== undefined ? String(o.name).trim() : c.name,
      position: o.position !== undefined ? String(o.position).trim() : (c.position || ''),
      photo: o.photo !== undefined ? o.photo : (c.photo || null),
      role: role,
      sections: o.sections !== undefined ? o.sections : (c.sections || []),
      perm: normalizePerm(o.perm !== undefined ? o.perm : c.perm, role),
      active: isOwnerDoc ? true : (o.active !== undefined ? !!o.active : c.active !== false),
      updatedAt: nowIso()
    };
    try {
      const batch = db.batch();
      batch.update(ref, patch);
      if (patch.name !== c.name && c.username) batch.set(db.collection('login_directory').doc(docKey(c.username)), { name: patch.name }, { merge: true });
      batch.set(logRef(), logEntry('update', 'team', c.username || uid, 'แก้ไขผู้ใช้งาน ' + patch.name + (patch.active ? '' : ' (ระงับการใช้งาน)')));
      await batch.commit();
    } catch (e) { throw new Error(thErr(e)); }
  };

  // ลบผู้ใช้: ลบออกจากรายชื่อและปิดการล็อกอิน (บัญชี Auth ที่ค้างอยู่ไม่มีสิทธิ์อะไร ลบทิ้งได้ที่ Firebase Console)
  FBL.removeMember = async function (uid) {
    requireOwner();
    const ref = db.collection('team').doc(uid);
    const cur = await ref.get();
    if (!cur.exists) return;
    const c = cur.data();
    if (c.role === 'owner') throw new Error('ลบเจ้าของระบบไม่ได้');
    try {
      const batch = db.batch();
      batch.delete(ref);
      if (c.username) batch.delete(db.collection('login_directory').doc(docKey(c.username)));
      batch.set(logRef(), logEntry('delete', 'team', c.username || uid, 'ลบผู้ใช้งาน ' + c.name));
      await batch.commit();
      loginNames = null;
    } catch (e) { throw new Error(thErr(e)); }
  };

  // ตั้งรหัสผ่านใหม่ให้ผู้อื่น: Firebase ฝั่งเบราว์เซอร์แก้รหัสคนอื่นตรงๆ ไม่ได้ จึงสร้างบัญชีล็อกอินใหม่ให้แล้วย้ายข้อมูลไป (ผลเหมือนเปลี่ยนรหัส)
  FBL.resetMemberPassword = async function (uid, newPassword) {
    requireOwner();
    if (FBL.user && uid === FBL.user.uid) { await FBL.changeMyPassword(newPassword); return; }
    const ref = db.collection('team').doc(uid);
    const cur = await ref.get();
    if (!cur.exists) throw new Error('ไม่พบผู้ใช้นี้');
    const c = cur.data();
    try {
      const email = newEmail();
      const newUid = await createAuthUserSecondary(email, newPassword);
      const batch = db.batch();
      batch.delete(ref);
      batch.set(db.collection('team').doc(newUid), Object.assign({}, c, { email: email, updatedAt: nowIso() }));
      if (c.username) batch.set(db.collection('login_directory').doc(docKey(c.username)), { email: email, uid: newUid, name: c.name });
      batch.set(logRef(), logEntry('update', 'team', c.username || uid, 'ตั้งรหัสผ่านใหม่ให้ ' + c.name));
      await batch.commit();
    } catch (e) { throw new Error(thErr(e)); }
  };

  /* ======================================================================
     อ่านข้อมูลแบบ realtime (แทน doGet ของ Code.gs)
     ====================================================================== */
  const subs = {};
  function toRow(table, data) {
    const cfg = TABLES[table];
    const json = cfg.jsonFields || [];
    const row = {};
    cfg.columns.forEach(function (c) {
      let v = data[c];
      if (v === undefined || v === null) v = '';
      if (json.indexOf(c) !== -1 && typeof v === 'string' && v) {
        try { v = JSON.parse(v); } catch (e) { /* เก็บค่าดิบไว้ถ้า parse ไม่ได้ (เหมือนเดิม) */ }
      }
      row[c] = v;
    });
    return row;
  }

  function watch(table) {
    if (!TABLES[table]) return Promise.reject(new Error('ไม่รู้จักตาราง: ' + table));
    if (subs[table]) return subs[table].first;
    const s = subs[table] = { rows: [], firstDone: false };
    s.first = new Promise(function (resolve, reject) {
      let cacheTimer = null;
      function done() { if (s.firstDone) return; s.firstDone = true; if (cacheTimer) clearTimeout(cacheTimer); resolve(); }
      s.unsub = db.collection(table).onSnapshot({ includeMetadataChanges: true }, function (snap) {
        // เรียงตามลำดับที่บันทึก (_c = เวลาสร้าง) ให้เหมือนลำดับแถวใน Google Sheet เดิม — บางหน้าใช้ลำดับนี้ตั้งเลขที่รายการ
        const docs = snap.docs.slice().sort(function (a, b) {
          const ca = a.get('_c') || 0, cb = b.get('_c') || 0;
          return ca !== cb ? ca - cb : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
        });
        s.created = {};
        docs.forEach(function (d) { s.created[d.id] = d.get('_c') || 0; });
        s.rows = docs.map(function (d) { return toRow(table, d.data()); });
        if (!s.firstDone) {
          // รอข้อมูลล่าสุดจากเซิร์ฟเวอร์ก่อน (กันหน้าเว็บวาดจากแคชเก่า) — ถ้าออฟไลน์เกิน 4 วินาทีค่อยใช้แคชในเครื่องแทน
          if (!snap.metadata.fromCache) done();
          else if (!cacheTimer) cacheTimer = setTimeout(done, 4000);
          return;
        }
        if (snap.metadata.fromCache || snap.metadata.hasPendingWrites) return;
        // มีการเปลี่ยนแปลงที่มาจากเซิร์ฟเวอร์ (ไม่ใช่การบันทึกของเครื่องนี้เอง) → แจ้งผู้ใช้
        const remote = snap.docChanges().some(function (ch) { return !ch.doc.metadata.hasPendingWrites; });
        if (remote && Date.now() - lastLocalWrite > 4000) notifyRemoteChange(table);
      }, function (err) {
        console.error('watch ' + table + ' failed', err);
        if (!s.firstDone) { s.firstDone = true; delete subs[table]; reject(new Error(thErr(err))); }
        else showToast('การเชื่อมต่อข้อมูล "' + (TABLES[table].label || table) + '" ขัดข้อง: ' + thErr(err));
      });
    });
    return s.first;
  }
  let lastLocalWrite = 0;

  // อ่านตารางเดียว — ได้ array ของแถว (สำเนาใหม่ทุกครั้ง แก้ไขได้ไม่กระทบแคช) รูปแบบเหมือน Code.gs เดิม
  FBL.apiGet = async function (table) {
    await FBL.ready;
    await watch(table);
    return clone(subs[table].rows);
  };
  FBL.apiGetMultiple = async function (tables) {
    await FBL.ready;
    await Promise.all(tables.map(watch));
    const out = {};
    tables.forEach(function (t) { out[t] = clone(subs[t].rows); });
    return out;
  };
  // อ่านจากแคชในหน่วยความจำทันที (ต้องเคย apiGet ตารางนั้นมาก่อน) — ไม่รอเน็ต
  FBL.rows = function (table) { return subs[table] ? clone(subs[table].rows) : []; };
  FBL.loaded = function (table) { return !!(subs[table] && subs[table].firstDone); };

  /* ======================================================================
     เขียนข้อมูล (แทน doPost ของ Code.gs) — ทุกคำสั่งบันทึก activity_log ในชุดเดียวกัน (atomic batch)
     ====================================================================== */
  function logRef() { return db.collection('activity_log').doc(); }
  function logEntry(action, table, targetId, summary) {
    return {
      ts: firebase.firestore.FieldValue.serverTimestamp(),
      at: nowIso(),
      actorUid: FBL.user ? FBL.user.uid : '',
      actorName: FBL.user ? FBL.user.name : '',
      page: FBL.page,
      section: sectionOf(table) || (table === 'team' ? 'main' : ''),
      action: action,
      table: table,
      targetId: String(targetId == null ? '' : targetId),
      summary: String(summary || '').slice(0, 500)
    };
  }
  const ACTION_TH = { add: 'เพิ่ม', update: 'แก้ไข', delete: 'ลบ (ย้ายไปถังขยะ)', restore: 'กู้คืน', purge: 'ลบถาวร', import: 'นำเข้า' };
  FBL.ACTION_TH = ACTION_TH;
  const LABEL_FIELDS = ['name', 'itemName', 'staffName', 'requesterName', 'jobName', 'sectionName', 'highway', 'subject', 'billType', 'type', 'label', 'vehicleId', 'materialId', 'kind', 'category', 'cycle', 'date'];
  function summaryOf(action, table, id, data) {
    let label = '';
    for (let i = 0; i < LABEL_FIELDS.length; i++) {
      const f = LABEL_FIELDS[i];
      if (data && data[f] !== undefined && data[f] !== '' && typeof data[f] !== 'object') { label = ' — ' + data[f]; break; }
    }
    return (ACTION_TH[action] || action) + ' ' + (TABLES[table] ? TABLES[table].label : table) + ' (' + id + ')' + label;
  }

  let lastAutoId = 0;
  function autoId(prefix) {
    let t = Date.now();
    if (t <= lastAutoId) t = lastAutoId + 1; // กันรหัสชนกันเมื่อบันทึกหลายรายการในมิลลิวินาทีเดียวกัน
    lastAutoId = t;
    return prefix + '-' + t;
  }
  function castNumeric(cfg, data) {
    (cfg.numericFields || []).forEach(function (f) {
      if (data[f] !== undefined && data[f] !== '' && data[f] !== null) {
        const n = Number(data[f]);
        data[f] = isFinite(n) ? n : data[f];
      }
    });
  }
  // เฉพาะคอลัมน์ที่รู้จัก (เหมือน buildRowValues_ เดิม) — JSON field เก็บเป็นข้อความ, undefined = ไม่แตะค่านั้น
  function toDoc(cfg, data, fillMissing) {
    const json = cfg.jsonFields || [];
    const out = {};
    cfg.columns.forEach(function (c) {
      let v = data[c];
      if (v === undefined) { if (fillMissing) out[c] = ''; return; }
      if (json.indexOf(c) !== -1 && v !== null && typeof v !== 'string') v = JSON.stringify(v);
      if (typeof v === 'number' && !isFinite(v)) v = null;
      out[c] = v;
    });
    return out;
  }

  // กลุ่มการลบ: การลบหลายรายการติดกันภายใน 6 วินาที (เช่น ลบใบสั่งการพร้อมรายการตัดวัสดุ/น้ำมันที่ผูกกัน)
  // นับเป็นชุดเดียวกันในถังขยะ — กู้คืนทีเดียวได้ครบทั้งชุด
  let delGroup = null, delGroupAt = 0;
  function deleteGroupId() {
    if (!delGroup || Date.now() - delGroupAt > 6000) delGroup = 'G' + Date.now() + '-' + randomId(4);
    delGroupAt = Date.now();
    return delGroup;
  }

  // apiPost(action, table, data, id, options) — action = add | update | delete (รูปแบบเดียวกับ Code.gs)
  // options.trash === false : ลบโดยไม่เก็บลงถังขยะ (ใช้กับการลบเพื่อบันทึกทับ เช่น แก้ไขใบสั่งการแล้วสร้างรายการตัดคลังใหม่)
  FBL.apiPost = async function (action, table, data, id, options) {
    await FBL.ready;
    const cfg = TABLES[table];
    if (!cfg) throw new Error('ไม่รู้จักตาราง: ' + table);
    options = options || {};
    if (!canWriteTable(table)) throw new Error('บัญชีของคุณไม่มีสิทธิ์แก้ไขข้อมูลใน "' + SECTIONS[cfg.section].label + '"');
    lastLocalWrite = Date.now();
    try {
      if (action === 'add' || action === 'update') {
        const d = clone(data || {});
        if (action === 'add' && cfg.idPrefix && !d[cfg.idField]) d[cfg.idField] = autoId(cfg.idPrefix);
        if (d[cfg.idField] === undefined || d[cfg.idField] === '' || d[cfg.idField] === null) {
          throw new Error(action === 'add' ? ('ไม่มีค่า ' + cfg.idField + ' — ตารางนี้ต้องระบุเองจากหน้าเว็บ') : ('ไม่มี ' + cfg.idField + ' ที่จะใช้ค้นหารายการที่จะแก้'));
        }
        castNumeric(cfg, d);
        d.lastUpdated = nowIso();
        const ref = db.collection(table).doc(docKey(d[cfg.idField]));
        const batch = db.batch();
        if (action === 'add') batch.set(ref, Object.assign(toDoc(cfg, d, true), { _c: Date.now() }));
        else batch.set(ref, toDoc(cfg, d, false), { merge: true });
        batch.set(logRef(), logEntry(action, table, d[cfg.idField], summaryOf(action, table, d[cfg.idField], d)));
        await batch.commit();
        return d;
      }
      if (action === 'delete') {
        if (id === undefined || id === null || id === '') throw new Error('ไม่ได้ส่งรหัสรายการที่จะลบมา');
        if (!canDeleteRow(table)) throw new Error(table === 'ledger_locks' ? 'บัญชีของคุณไม่มีสิทธิ์ปลดล็อกเดือนบัญชี' : 'บัญชีของคุณไม่มีสิทธิ์ลบข้อมูล (ติดต่อเจ้าของระบบ)');
        const key = docKey(id);
        const ref = db.collection(table).doc(key);
        let before = null, created = 0;
        try {
          const cachedRow = subs[table] && subs[table].rows.find(function (r) { return String(r[cfg.idField]) === String(id); });
          if (cachedRow) { before = cachedRow; created = (subs[table].created || {})[key] || 0; }
          else { const snap = await ref.get(); before = snap.exists ? toRow(table, snap.data()) : null; created = snap.exists ? (snap.get('_c') || 0) : 0; }
        } catch (e) { before = null; }
        const batch = db.batch();
        batch.delete(ref);
        const useTrash = cfg.trash !== false && options.trash !== false && before;
        if (useTrash) {
          batch.set(db.collection('trash').doc(), {
            table: table, docKey: key, rowId: String(id), section: cfg.section,
            data: JSON.stringify(toDoc(cfg, before, false)), created: created,
            label: summaryOf('delete', table, id, before).replace(/^ลบ \(ย้ายไปถังขยะ\) /, ''),
            groupId: deleteGroupId(),
            deletedAt: nowIso(), deletedTs: firebase.firestore.FieldValue.serverTimestamp(),
            deletedByUid: FBL.user.uid, deletedBy: FBL.user.name, page: FBL.page
          });
        }
        batch.set(logRef(), logEntry('delete', table, id, useTrash ? summaryOf('delete', table, id, before || {}) : ('ลบ ' + cfg.label + ' (' + id + ')')));
        await batch.commit();
        return { deleted: true, key: id };
      }
      throw new Error('ไม่รู้จัก action: ' + action);
    } catch (e) {
      if (e && e.code) throw new Error(thErr(e));
      throw e;
    }
  };

  /* ======================================================================
     ถังขยะ
     ====================================================================== */
  // cb(items) — ผู้มีสิทธิ์กู้คืน/ลบถาวร/ดูประวัติ เห็นทุกรายการ, คนอื่นเห็นเฉพาะที่ตัวเองลบ
  FBL.watchTrash = function (cb) {
    let q = db.collection('trash');
    if (!(FBL.can('restore') || FBL.can('purge') || FBL.can('viewLog'))) q = q.where('deletedByUid', '==', FBL.user.uid);
    return q.onSnapshot(function (snap) {
      const items = snap.docs.map(function (d) { return Object.assign({ __id: d.id }, d.data()); });
      items.sort(function (a, b) { return String(b.deletedAt).localeCompare(String(a.deletedAt)); });
      cb(items);
    }, function (err) { console.warn('watch trash failed', err && err.code); cb(null, thErr(err)); });
  };

  // กู้คืน: เขียนข้อมูลกลับตารางเดิม + ลบออกจากถังขยะ (รหัสเดิม) — items = รายการในถังขยะ (จาก watchTrash)
  FBL.restoreTrash = async function (items) {
    if (!FBL.can('restore')) throw new Error('บัญชีของคุณไม่มีสิทธิ์กู้คืนข้อมูล');
    const list = (items || []).filter(Boolean);
    for (let i = 0; i < list.length; i += 150) {
      const batch = db.batch();
      list.slice(i, i + 150).forEach(function (it) {
        const cfg = TABLES[it.table];
        if (!cfg) return;
        let data = {};
        try { data = JSON.parse(it.data || '{}'); } catch (e) { data = {}; }
        batch.set(db.collection(it.table).doc(it.docKey), Object.assign(toDoc(cfg, data, true), { _c: it.created || Date.now() }));
        batch.delete(db.collection('trash').doc(it.__id));
        batch.set(logRef(), logEntry('restore', it.table, it.rowId, 'กู้คืน ' + (it.label || it.rowId)));
      });
      try { await batch.commit(); } catch (e) { throw new Error(thErr(e)); }
    }
  };
  FBL.purgeTrash = async function (items) {
    if (!FBL.can('purge')) throw new Error('บัญชีของคุณไม่มีสิทธิ์ลบถาวร');
    const list = (items || []).filter(Boolean);
    for (let i = 0; i < list.length; i += 200) {
      const batch = db.batch();
      list.slice(i, i + 200).forEach(function (it) {
        batch.delete(db.collection('trash').doc(it.__id));
        batch.set(logRef(), logEntry('purge', it.table, it.rowId, 'ลบถาวร ' + (it.label || it.rowId)));
      });
      try { await batch.commit(); } catch (e) { throw new Error(thErr(e)); }
    }
  };

  /* ======================================================================
     ประวัติการใช้งาน (activity_log) — เพิ่มได้อย่างเดียว อ่านได้เฉพาะผู้มีสิทธิ์ดูประวัติ
     ====================================================================== */
  FBL.watchLog = function (limit, cb) {
    return db.collection('activity_log').orderBy('ts', 'desc').limit(limit || 300).onSnapshot(function (snap) {
      cb(snap.docs.map(function (d) {
        const x = d.data();
        const ms = x.ts && x.ts.toMillis ? x.ts.toMillis() : (x.at ? Date.parse(x.at) : Date.now());
        return Object.assign({ __id: d.id, ms: ms }, x);
      }));
    }, function (err) { console.warn('watch log failed', err && err.code); cb(null, thErr(err)); });
  };

  /* ======================================================================
     สถานะออนไลน์ (presence) — ทุกคนส่งสัญญาณของตัวเองทุก 2 นาทีขณะเปิดหน้าอยู่
     ====================================================================== */
  const PRESENCE_EVERY_MS = 120000;
  let presenceTimer = null, presenceOnVisible = null, presenceOnHide = null;
  function presenceWrite(online) {
    if (!FBL.user) return Promise.resolve();
    return db.collection('presence').doc(FBL.user.uid).set({
      name: FBL.user.name, online: online, page: FBL.page,
      lastSeen: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(function () { /* ข้ามเงียบๆ */ });
  }
  function startPresence() {
    stopPresence();
    presenceWrite(true);
    presenceTimer = setInterval(function () { if (document.visibilityState === 'visible') presenceWrite(true); }, PRESENCE_EVERY_MS);
    presenceOnVisible = function () { if (document.visibilityState === 'visible') presenceWrite(true); };
    presenceOnHide = function () { presenceWrite(false); };
    document.addEventListener('visibilitychange', presenceOnVisible);
    window.addEventListener('pagehide', presenceOnHide);
  }
  function stopPresence() {
    if (presenceTimer) { clearInterval(presenceTimer); presenceTimer = null; }
    if (presenceOnVisible) { document.removeEventListener('visibilitychange', presenceOnVisible); presenceOnVisible = null; }
    if (presenceOnHide) { window.removeEventListener('pagehide', presenceOnHide); presenceOnHide = null; }
  }
  FBL.watchPresence = function (cb) {
    return db.collection('presence').onSnapshot(function (snap) {
      cb(snap.docs.map(function (d) {
        const x = d.data();
        return { uid: d.id, name: x.name, online: x.online !== false, page: x.page || '', lastSeen: x.lastSeen && x.lastSeen.toMillis ? x.lastSeen.toMillis() : Date.now() };
      }));
    }, function (err) { console.warn('watch presence failed', err && err.code); });
  };

  /* ======================================================================
     ค่าสถานะที่ใช้ร่วมกันของแต่ละหน้า (app_state/{main|s1..s4}) — แทน localStorage เดิมที่อยู่เครื่องเดียว
     ====================================================================== */
  FBL.stateGet = async function (key) {
    await FBL.ready;
    try {
      const d = await db.collection('app_state').doc(key).get();
      if (!d.exists) return {};
      try { return JSON.parse(d.data().json || '{}'); } catch (e) { return {}; }
    } catch (e) { console.warn('stateGet ' + key, e && e.code); return {}; }
  };
  const stateLast = {};
  FBL.stateSet = async function (key, obj) {
    await FBL.ready;
    const json = JSON.stringify(obj || {});
    if (stateLast[key] === json) return;
    const canWrite = key === 'main' ? FBL.canView('main') : FBL.canEdit(key);
    if (!canWrite) return;
    stateLast[key] = json;
    lastLocalWrite = Date.now();
    try {
      await db.collection('app_state').doc(key).set({ json: json, updatedAt: nowIso(), updatedBy: FBL.user.name });
    } catch (e) { stateLast[key] = null; console.warn('stateSet ' + key, e && e.code); }
  };
  FBL.stateMarkLoaded = function (key, obj) { stateLast[key] = JSON.stringify(obj || {}); };

  /* ======================================================================
     ส่งออก / นำเข้า (เจ้าของระบบ/ผู้มีสิทธิ์ส่งออก)
     ====================================================================== */
  FBL.exportAll = async function () {
    if (!FBL.can('export')) throw new Error('บัญชีของคุณไม่มีสิทธิ์ส่งออกข้อมูล');
    const names = Object.keys(TABLES);
    const out = {};
    await Promise.all(names.map(watch));
    names.forEach(function (t) { out[t] = clone(subs[t].rows); });
    return out;
  };

  // นำเข้าไฟล์ Excel ที่ export จาก Google Sheet เดิม (ชื่อแท็บ = ชื่อตาราง) — เขียนทับรายการรหัสเดียวกัน รันซ้ำได้
  // XLSXlib = SheetJS, buffer = ArrayBuffer; ข้ามแท็บ users และ activity_log (รหัสผ่านย้ายไม่ได้)
  FBL.importWorkbook = async function (XLSXlib, buffer, progress) {
    if (!FBL.isOwner()) throw new Error('เฉพาะเจ้าของระบบเท่านั้น');
    const wb = XLSXlib.read(buffer, { type: 'array', cellDates: false });
    const report = [];
    const importBase = 1000000000000; // ก่อนรายการที่สร้างในระบบใหม่เสมอ (Date.now() มากกว่านี้)
    function isoOf(v) {
      if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
      return v;
    }
    const DATE_COLS = /^(date|from|to|startDate|birth|dateFrom|dateTo|requestDate|workDate|approvedDate|reportDate|dueDate|paidDate|paidDateA|paidDateB|stageDate|clearedDate|recordedDate)$/;
    const MONTH_COLS = /^(cycle|monthKey)$/; // ค่า "2026-07" ที่ Sheets อาจแปลงเป็นวันที่ → คืนเป็นปี-เดือน
    for (const name of wb.SheetNames) {
      const table = String(name).trim();
      const cfg = TABLES[table];
      if (!cfg) continue;
      const rows = XLSXlib.utils.sheet_to_json(wb.Sheets[name], { defval: '', raw: true });
      const writes = [];
      rows.forEach(function (r) {
        const d = {};
        Object.keys(r).forEach(function (k) {
          let v = r[k];
          if (DATE_COLS.test(k)) v = isoOf(v);
          else if (MONTH_COLS.test(k) && typeof v === 'number') v = String(isoOf(v)).slice(0, 7);
          d[k] = v;
        });
        if (d[cfg.idField] === '' || d[cfg.idField] === undefined) return;
        castNumeric(cfg, d);
        if (!d.lastUpdated) d.lastUpdated = nowIso();
        // _c = ลำดับแถวเดิมในชีต (ให้หน้าเว็บเรียงรายการเหมือนเดิม)
        writes.push({ ref: db.collection(table).doc(docKey(d[cfg.idField])), data: Object.assign(toDoc(cfg, d, true), { _c: importBase + writes.length }) });
      });
      for (let i = 0; i < writes.length; i += 400) {
        const batch = db.batch();
        writes.slice(i, i + 400).forEach(function (w) { batch.set(w.ref, w.data); });
        try { await batch.commit(); } catch (e) { throw new Error(thErr(e)); }
        if (progress) progress(cfg.label + ': ' + Math.min(i + 400, writes.length) + '/' + writes.length);
      }
      if (writes.length) report.push(cfg.label + ' (' + table + ') ' + writes.length + ' รายการ');
    }
    if (report.length) {
      await db.collection('activity_log').add(logEntry('import', 'import', '', 'นำเข้าข้อมูลจาก Excel: ' + report.join(', ')));
    }
    return report;
  };
})();
