import { EventEmitter } from 'events';
import { get } from 'request';
import JSONStream from 'json-stream';
import flatMap from 'lodash.flatmap';
import findKey from 'lodash.findkey';
import pick from 'lodash.pick';

// default emitted events
const defaultEvents = [
  'added',
  'modified',
  'deleted'
];

// allowed query parameters to be passed as option
const queryParameters = [
  'labelSelector',
  'fieldSelector',
  'resourceVersion',
  'timeoutSeconds'
];

// supported resources by API version
const apiResources = {
  v1: [
    'nodes',
    'namespaces',
    'endpoints',
    'events',
    'limitranges',
    'persistentvolumeclaims',
    'persistentvolumes',
    'pods',
    'podtemplates',
    'replicationcontrollers',
    'resourcequotas',
    'secrets',
    'serviceaccounts',
    'services'
  ],
  v1beta1: [
    'horizontalpodautoscalers',
    'ingresses',
    'jobs'
  ],
  'apps/v1beta1': [
    'deployments',
  ]
}

const notNamespaced = [
  'namespaces',
  'persistentvolumes',
  'nodes'
];

export default class extends EventEmitter {
  constructor (res = '', options = {}) {
    // be an EventEmitter
    super();

    // check for k8s URL
    if (!options.url) {
      throw new Error('Missing Kubernetes API URL.');
    }

    // force plural form
    let resource = res.toLowerCase();
    if (resource.charAt(resource.length - 1) !== 's') {
      resource += 's';
    }

    // check if resource is supported
    const resources = flatMap(apiResources);
    if (!resources.includes(resource)) {
      throw new Error(
        'Unknown resource. Available resources: ' + resources.join(', ')
      );
    }

    // get api version
    const version = findKey(apiResources, res => res.includes(resource));

    // options
    const namespace = options.namespace;
    const name = options.name;
    const events = options.events || defaultEvents;

    let baseUrl = `${options.url}/api/${version}`;

    if (version === 'apps/v1beta1') {
      baseUrl = `${options.url}/apis/${version}`;
    }

    // default HTTP resource
    // eg: http://api-server/api/v1/pods
    this.url = `${baseUrl}/${resource}`;

    // update url if resource is namespaced
    if (namespace) {
      this.url = `${baseUrl}/namespaces/${namespace}/${resource}`;
    }

    // update url if resource is filtered by his name
    if (name) {
      // resource is not namespaced
      if (notNamespaced.includes(resource)) {
        this.url = `${baseUrl}/watch/${resource}/${name}`;
      }
      else {
        this.url =
          `${baseUrl}/watch/namespaces/${namespace}/${resource}/${name}`;
      }
    }

    // we will get a stream of json data..
    const stream = new JSONStream();
    stream.on('data', event => {
      if (event && event.type) {
        // emit event if we have to
        const type = event.type.toLowerCase();
        if (events.includes(type)) {
          this.emit(type, event.object);
        }
      }
      else {
        // something not expected, emit event as an error
        this.emit('error', event);
      }
    })
    .on('end', event => this.emit('end', event));

    // request options
    const watchRequest = {
      uri: this.url,
      qs: {
        watch: true,                        // watch resource
        ...pick(options, queryParameters)   // check for extra parameters
      },
      ...options.request                    // HTTP request options
    }

    get(watchRequest).pipe(stream);
    return this;
  }
}
