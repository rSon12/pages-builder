const { expect } = require('chai');
const nock = require('nock');
const url = require('url');
const mockBuildLogCallback = require('./nocks/build-log-callback-nock');
const mockBuildStatusCallback = require('./nocks/build-status-callback-nock');

const BuildTimeoutReporter = require('../src/build-timeout-reporter');

describe('BuildTimeoutReporter', () => {
  afterEach(() => {
    nock.cleanAll();
  });

  describe('reportBuildTimeout', () => {
    it("should send a request to the build's status and log callback", async () => {
      const logURL = url.parse('https://www.example.gov/log');
      const statusURL = url.parse('https://www.example.gov/status');
      const logCallbackNock = mockBuildLogCallback(logURL);
      const statusCallbackNock = mockBuildStatusCallback(statusURL);

      const build = {
        containerEnvironment: {
          LOG_CALLBACK: logURL.href,
          STATUS_CALLBACK: statusURL.href,
        },
      };

      await BuildTimeoutReporter.reportBuildTimeout(build);
      expect(logCallbackNock.isDone()).to.be.true;
      expect(statusCallbackNock.isDone()).to.be.true;
    });
  });
});
