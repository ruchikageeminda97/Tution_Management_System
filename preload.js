const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('tuition', Object.freeze({
  auth: {
    status: invoke('auth:status'), setup: invoke('auth:setup'),
    login: invoke('auth:login'), recover: invoke('auth:recover'),
    resetDatabase: invoke('auth:resetDatabase'),
    logout: invoke('auth:logout')
  },
  images: { chooseDirectory: invoke('images:chooseDirectory') },
  dashboard: { get: invoke('dashboard:get') },
  students: {
    list: invoke('students:list'), save: invoke('students:save'), delete: invoke('students:delete'),
    photo: invoke('students:photo'), choosePhoto: invoke('students:choosePhoto'),
    assignRfid: invoke('students:assignRfid'), removeRfid: invoke('students:removeRfid'), byRfid: invoke('students:byRfid'),
    fees: invoke('students:fees'), payFees: invoke('students:payFees'),
    importExcel: () => ipcRenderer.invoke('records:import', 'students'),
    downloadTemplate: () => ipcRenderer.invoke('records:downloadTemplate', 'students')
  },
  teachers: {
    list: invoke('teachers:list'), save: invoke('teachers:save'), delete: invoke('teachers:delete'),
    importExcel: () => ipcRenderer.invoke('records:import', 'teachers'),
    downloadTemplate: () => ipcRenderer.invoke('records:downloadTemplate', 'teachers')
  },
  halls: { list: invoke('halls:list'), save: invoke('halls:save'), delete: invoke('halls:delete') },
  classes: {
    list: invoke('classes:list'), detail: invoke('classes:detail'), save: invoke('classes:save'),
    enroll: invoke('classes:enroll'), dropEnrollment: invoke('classes:dropEnrollment'),
    updateDiscount: invoke('classes:updateDiscount')
  },
  sessions: {
    list: invoke('sessions:list'), generate: invoke('sessions:generate'), attendance: invoke('sessions:attendance'),
    scheduleSpecial: invoke('sessions:scheduleSpecial'),
    exportAttendancePDF: invoke('sessions:exportAttendancePDF'),
    start: invoke('sessions:start'), classStarted: invoke('sessions:classStarted'),
    mark: invoke('sessions:mark'), end: invoke('sessions:end')
  },
  payments: {
    overview: invoke('payments:overview'), pay: invoke('payments:pay'),
    pendingFees: invoke('payments:pendingFees'), make: invoke('payments:make'),
    receipt: invoke('payments:receipt'), exportReceipt: invoke('payments:exportReceipt'),
    printReceipt: invoke('payments:printReceipt'), recentReceipts: invoke('payments:recentReceipts')
  },
  reports: {
    classEarnings: invoke('reports:classEarnings'),
    exportClassPaymentPDF: invoke('reports:exportClassPaymentPDF'),
    teacherBalances: invoke('reports:teacherBalances'),
    paymentRecords: invoke('reports:paymentRecords'),
    studentAttendance: invoke('reports:studentAttendance'),
    sessions: invoke('reports:sessions'),
    pendingPayments: invoke('reports:pendingPayments'),
    exportPDF: invoke('reports:exportPDF'),
    exportDailySummaryPDF: invoke('reports:exportDailySummaryPDF')
  },
  payouts: {
    list: invoke('payouts:list'),
    add: invoke('payouts:add'),
    setOpeningBalance: invoke('payouts:setOpeningBalance'),
    importOpeningBalances: invoke('payouts:importOpeningBalances'),
    downloadOpeningBalanceTemplate: invoke('payouts:downloadOpeningBalanceTemplate')
  },
  settings: {
    organization: invoke('settings:organization'),
    saveOrganization: invoke('settings:saveOrganization'),
    saveImageDirectory: invoke('settings:saveImageDirectory')
  },
  backup: {
    create: invoke('backup:create'),
    restore: invoke('backup:restore'),
    chooseDirectory: invoke('backup:chooseDirectory'),
    saveDirectory: invoke('backup:saveDirectory'),
    getSettings: invoke('backup:getSettings'),
    saveSettings: invoke('backup:saveSettings'),
    googleConnect: invoke('backup:googleConnect'),
    googleDisconnect: invoke('backup:googleDisconnect'),
    googleStatus: invoke('backup:googleStatus'),
    googleUpload: invoke('backup:googleUpload'),
    googleList: invoke('backup:googleList'),
    googleRestore: invoke('backup:googleRestore')
  }
}));
