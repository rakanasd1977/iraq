// أدوار حسابات الامتياز التي تُلزم بالمصادقة الثنائية وتُربط ببصمة الجهاز.
// مصدر وحيد لتجنّب تكرار التعريف في middleware/auth.ts و routes/auth.ts.
module.exports = { PRIVILEGED_ROLES: ['admin', 'agent', 'provider'] };
