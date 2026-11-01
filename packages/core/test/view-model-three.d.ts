// three is not a dependency of @protoboardai/core (it is hoisted from the viewer packages); the view-model test
// loads it only to prove the sidecar round-trips through three's GLTFLoader, so its types are left loose here.
declare module "three";
declare module "three/examples/jsm/loaders/GLTFLoader.js";
