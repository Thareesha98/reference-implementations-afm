import ballerina/http;

// Minimal module-level HTTP service to verify Devant builds a Ballerina
// Integrator project (module-level service, no main(), no Java deps).
service / on new http:Listener(8090) {

    resource function get ping() returns string {
        return "pong";
    }
}
