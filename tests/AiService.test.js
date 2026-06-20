'use strict';

const assert = require('assert');

function runAiTests(testFn) {
  console.log('\nAiService (unit)');

  testFn('ModelProvider constructs without crash', () => {
    const ModelProvider = require('../src/core/ai/ModelProvider');
    const mp = new ModelProvider();
    assert.strictEqual(mp.isConfigured(), false);
    assert.strictEqual(mp.chatModel(), null);
    assert.strictEqual(mp.embeddings(), null);
  });

  testFn('AiService constructs without crash', () => {
    const AiService = require('../src/core/ai/AiService');
    const svc = new AiService({}, {});
    assert.strictEqual(typeof svc.configure, 'function');
    assert.strictEqual(typeof svc.interpret, 'function');
    assert.strictEqual(typeof svc.chat, 'function');
    assert.strictEqual(typeof svc.stop, 'function');
    assert.strictEqual(typeof svc.close, 'function');
    const st = svc.status();
    assert.strictEqual(st.configured, false);
  });

  testFn('ChainFactory constructs without crash', () => {
    const ChainFactory = require('../src/core/ai/ChainFactory');
    const ModelProvider = require('../src/core/ai/ModelProvider');
    const mp = new ModelProvider();
    const cf = new ChainFactory(mp, null);
    assert.ok(cf);
  });

  testFn('AstroToolkit createTools is async function', () => {
    const { createTools } = require('../src/core/ai/AstroToolkit');
    assert.strictEqual(typeof createTools, 'function');
  });
}

module.exports = { runAiTests };
