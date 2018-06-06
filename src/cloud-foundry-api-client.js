const request = require('request');
const url = require('url');
const CloudFoundryAuthClient = require('./cloud-foundry-auth-client');

const STATE_STARTED = 'STARTED';

const expectedNumBuildContainers = parseInt(process.env.EXPECTED_NUM_BUILD_CONTAINERS, 10);

class CloudFoundryAPIClient {
  constructor() {
    this._authClient = new CloudFoundryAuthClient();
  }

  fetchBuildContainers() {
    return this._authClient.accessToken().then(token => this._request(
        'GET',
        `/v2/spaces/${this._spaceGUID()}/apps`,
        token
      )).then(body => this._filterAppsResponse(JSON.parse(body)));
  }

  fetchAppStats(appGUID) {
    return this._authClient.accessToken().then(token => this._request(
        'GET',
        `/v2/apps/${appGUID}/stats`,
        token
      ));
  }
  
  fetchAppInstanceStates(container) {
    return this.fetchAppStats(container.guid)
    .then((appStats) => {
      return { guid: container.guid, name: container.name, statesCount: this._appInstanceStatesCount(JSON.parse(appStats)) };
    })
  }
  fetchAllAppInstanceErrors(buildContainers) {
    let instanceErrors = [];
    let promises = [];
    let statesCount;
    let bc = {};
    for(var i in buildContainers) {
      promises.push(this.fetchAppInstanceStates(buildContainers[i]));
    }

    return Promise.all(promises)  
    .then(instanceStates => {
      for(var i in instanceStates) {
        statesCount = instanceStates[i].statesCount;
        if (statesCount["CRASHED"] || statesCount["DOWN"] || statesCount["FLAPPING"] || statesCount["UNKNOWN"]) {
          instanceErrors.push(`${ instanceStates[i].name }:\tNot all instances for are running. ${ JSON.stringify(statesCount) }`);
        } else if (Object.keys(statesCount).length == 0) {
          instanceErrors.push(`${ instanceStates[i].name } has 0 running instances`);
        }
      }
      return instanceErrors;
    });
    
  }

  getBuildContainersState() {
    return this.fetchBuildContainers()
      .then((buildContainers) => {
        const numBuildContainers = buildContainers.length;
        const startedContainers = buildContainers.filter(bc => bc.state === STATE_STARTED);
        const allStarted = startedContainers.length === expectedNumBuildContainers;

        if (numBuildContainers < expectedNumBuildContainers) {
          return { error: `Expected ${expectedNumBuildContainers} build containers but only ${numBuildContainers} found.` };
        }

        if (!allStarted) {
          return { error: `Not all build containers are in the ${STATE_STARTED} state.` };
        }

        return this.fetchAllAppInstanceErrors(startedContainers)
        .then((instanceErrors) => {
          if (instanceErrors.length) {
            return { error: instanceErrors.join('\n') };
          }
          return {
            expected: expectedNumBuildContainers,
            found: numBuildContainers,
            started: startedContainers.length,
          };
        });                
      });
  }

  updateBuildContainer(container, environment) {
    return this._authClient.accessToken().then(token => this._request(
        'PUT',
        container.url,
        token,
        { environment_json: environment }
      )).then(() => this._authClient.accessToken()).then(token => this._request(
        'POST',
        `${container.url}/restage`,
        token
      ));
  }

  _buildContainerImageName() {
    return process.env.BUILD_CONTAINER_DOCKER_IMAGE_NAME;
  }

  _filterAppsResponse(response) {
    return response.resources
      .map(resource => this._buildContainerFromAppResponse(resource))
      .filter(buildContainer => buildContainer.dockerImage === this._buildContainerImageName());
  }

  _buildContainerFromAppResponse(appResponse) {
    return {
      guid: appResponse.metadata.guid,
      url: appResponse.metadata.url,
      name: appResponse.entity.name,
      dockerImage: appResponse.entity.docker_image,
      state: appResponse.entity.state,
    };
  }

  _appInstanceStatesCount(statsResponse) {
    const instances = Object.keys(statsResponse).map((i) => statsResponse[i]);
    let statesCount = {}
    for ( var i in instances) {
      if (statesCount[instances[i]['state']]){
        statesCount[instances[i]['state']]++;
      } else {
        statesCount[instances[i]['state']] = 1;
      }      
    }
    return statesCount;
  }

  _resolveAPIURL(path) {
    return url.resolve(
      process.env.CLOUD_FOUNDRY_API_HOST,
      path
    );
  }

  _request(method, path, accessToken, json) {
    return new Promise((resolve, reject) => {
      request({
        method: method.toUpperCase(),
        url: this._resolveAPIURL(path),
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        json,
      }, (error, response, body) => {
        if (error) {
          reject(error);
        } else if (response.statusCode > 399) {
          const errorMessage = `Received status code: ${response.statusCode}`;
          reject(new Error(body || errorMessage));
        } else {
          resolve(body);
        }
      });
    });
  }

  _spaceGUID() {
    return process.env.BUILD_SPACE_GUID;
  }
}

module.exports = CloudFoundryAPIClient;
