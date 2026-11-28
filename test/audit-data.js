// Data for the read-only audit (test/audit.js), written on an ordinary
// connection before the audit starts: a collection with a redundant index and a
// TTL index, a view, and a few profiled operations for mt.slow() / mt.explainLog().
var d = db.getSiblingDB('mtaudit');
d.dropDatabase();
var docs = [];
for (var i = 0; i < 200; i++) docs.push({ a: i, b: i % 3 === 0 ? 'x' : 'y', exp: new Date(Date.now() - i * 1000) });
d.c.insertMany(docs);
d.c.createIndex({ a: 1 });
d.c.createIndex({ a: 1, b: 1 });
d.c.createIndex({ exp: 1 }, { expireAfterSeconds: 86400 });
d.createView('v', 'c', [{ $match: { a: { $gt: 10 } } }]);
d.setProfilingLevel(2);
d.c.find({ a: 3 }).toArray();
d.c.find({ b: 'x' }).sort({ a: -1 }).toArray();
d.c.updateOne({ a: 1 }, { $set: { u: 1 } });
d.c.aggregate([{ $group: { _id: '$b', n: { $sum: 1 } } }]).toArray();
d.setProfilingLevel(0);
print('audit data ready');
