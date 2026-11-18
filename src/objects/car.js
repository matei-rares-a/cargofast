import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// *** CAR SETTINGS ***
const SPAWN               = new THREE.Vector3(0, 3, 0);
const CAR_ANGULAR_DAMPING = 1.0;
const MODEL_OFFSET_Y      = Math.PI / 2;
const MODEL_BODY_LIFT     = 0.50;  // shift car body mesh up relative to wheel center

// Chassis collider (box around car body only, wheels handled by raycasts)
const CHASSIS_W_FRAC      = 0.70;
const CHASSIS_H_FRAC      = 0.25;
const CHASSIS_L_FRAC      = 0.75;
const CHASSIS_OFFSET_Y    = 0.45;  // raise box so its bottom clears stair edges

// Roof pad: a thin plate on top of the chassis box, wider than it. When the car lies on its roof the pad is the
// surface that touches the ground, so the contact area is larger. It sits above the chassis, so driving upright is unchanged.
const ROOF_PAD_W_FRAC     = 0.90;
const ROOF_PAD_L_FRAC     = 0.90;
const ROOF_PAD_THICK      = 0.05;  // m

// *** VEHICLE CONTROLLER SETTINGS ***
const ENGINE_FORCE        = 60.0;  // per-wheel force — keep low to avoid jumping
const BRAKE_FORCE         = 1.5;  // gentle — prevents snap-stop bounce
const STEER_MAX_ANGLE     = 0.65;
const STEER_SMOOTHING     = 0.15;
const STEER_PHYS_SIGN     = 1;
const COAST_STOP_TIME     = 1.5;  // seconds from throttle release to full stop
const STEER_REDUCE_SPEED_START = 4.0;  // m/s where steering starts to reduce
const STEER_REDUCE_SPEED_END   = 14.0; // m/s where min steering factor is reached
const STEER_MIN_FACTOR         = 0.35; // max speed steering = 35% of max steer angle
const BRAKE_YAW_DAMP_RATE      = 18.0; // larger = stronger anti-spin yaw damping
const COAST_LATERAL_DAMP       = 4.0;  // 1/s, how fast the sideways slide fades while coasting

// Roof wobble: on its roof, A/D lean the car towards the pressed side. The lean is a damped pendulum that the
// keys push, so pressing in step with the swing pumps it until the car tips over onto its side and falls.
export const CAR_UPSIDE_DOWN_UP_Y = 0;    // car's up-axis y below this = the car lies on its roof
const LEAN_STIFFNESS           = 40.0;  // 1/s^2, pull back towards flat; natural swing period ~1 s
const LEAN_DAMPING             = 1.2;   // 1/s, energy loss: a lean dies out unless it is pushed
const LEAN_PUSH                = 24.0;  // rad/s^2 per held key or press; holding alone leans ~34 deg (PUSH / STIFFNESS)
const LEAN_SETTLE_EPS          = 0.01;  // rad and rad/s below which a lean counts as flat again (snap < 1 deg)
const LEAN_START_MAX_SPEED     = 0.5;   // m/s and rad/s; the lean only starts from rest (not while falling)
const LEAN_PULSE_TIME          = 0.5;   // s of push given by each new A/D press, so a tap is enough
const LEAN_ROLL_SPEED          = 3.0;   // rad/s, roll speed from the tipping angle onto the wheels

// Suspension
const SUSP_STIFFNESS      = 25.0;
const SUSP_COMPRESSION    = 1.8;  // high compression = no bounce on stop
const SUSP_RELAXATION     = 1.2;  // high relaxation = no overshoot on rebound
const SUSP_REST_LEN       = 0.45;
const SUSP_MAX_TRAVEL     = 0.60;
const SUSP_MAX_FORCE      = 600.0;

// Tire
const WHEEL_FRICTION_SLIP = 4.0;   // lower = smoother acceleration, less spin-out
const WHEEL_SIDE_FRICTION = 1.4;
const WHEEL_RADIUS_BIAS   = 1.0;   // 1.0 = physics sphere matches visual wheel radius exactly

// Visual
const WHEEL_SPIN_DIR      = -1;
const HOOD_SYNC_SCALE     = 0.06; // smaller body response to suspension travel
const HOOD_SYNC_LERP      = 0.02; // slower body response
const HOOD_SYNC_MAX       = 0.03; // clamp excessive hood movement
const WHEEL_VISUAL_TRAVEL_SCALE = 1.0;  // wheel mesh follows the raw suspension travel exactly, so it touches the ground (0.55 left the wheels ~22 cm in the ground)
const BODY_PITCH_SCALE    = 0.35; // pitch from front/rear suspension delta
const BODY_PITCH_LERP     = 0.05; // pitch smoothing
const BODY_PITCH_MAX      = 0.16; // radians

export class CarObject {
  constructor(scene, world, gui) {
    this.scene   = scene;
    this.world   = world;
    this.loader  = new GLTFLoader();

    this.car         = { mesh: null, rigidBody: null };
    this.vehicle     = null;
    this.carBodyGroup = null;
    this.bodyLiftCurrent = 0;  // smoothed body Z offset
    this.bodyPitchCurrent = 0; // smoothed body X rotation
    this.coastTimer = COAST_STOP_TIME;
    this.coastStartSpeed = 0; // forward speed when the throttle was released
    this.wasThrottle = false;
    this.wheelMeshes = { front: [], rear: [] };
    this.wheelPivots    = [];
    this.wheelInitQuats = [];
    this.wheelRadii     = [];  // physics radius per wheel
    this.frontCount     = 0;
    this.steerAngle     = 0;
    this.chassisHalf    = null; // chassis collider half extents (set in loadCar)
    this.collisionBoxes = null; // chassis + roof pad, see loadCar
    this.lastPress      = 0;    // A/D direction last frame: -1, 0 or +1
    this.pulse          = { dir: 0, time: 0 }; // short push started by a new press, seconds left
    this.roofContact    = null; // roof-side contact surface, see loadCar
    this.rock           = { active: false, rolling: false, rollDir: 0, phi: 0, omega: 0, pose: null }; // roof lean state, see _startLean
    this.ready          = false;
    this.inputBlocked   = false;
    this.pressed        = {};

    window.addEventListener('keydown', (e) => { e.preventDefault(); this.pressed[e.code] = true; });
    window.addEventListener('keyup',   (e) => { e.preventDefault(); this.pressed[e.code] = false; });

    const f = gui.addFolder('Car');
    this.settings = {
      engineForce:   ENGINE_FORCE,
      maxSteer:      STEER_MAX_ANGLE,
      suspStiffness: SUSP_STIFFNESS,
      frictionSlip:  WHEEL_FRICTION_SLIP,
    };
    f.add(this.settings, 'engineForce',    10,  300, 5).name('Engine Force');
    f.add(this.settings, 'maxSteer',      0.1,  1.0, 0.05).name('Max Steer');
    f.add(this.settings, 'suspStiffness',   5,  100, 1).name('Susp Stiffness').onChange((v) => {
      if (!this.vehicle) return;
      for (let i = 0; i < this.vehicle.numWheels(); i++) this.vehicle.setWheelSuspensionStiffness(i, v);
    });
    f.add(this.settings, 'frictionSlip',  0.5,   30, 0.5).name('Tire Friction').onChange((v) => {
      if (!this.vehicle) return;
      for (let i = 0; i < this.vehicle.numWheels(); i++) this.vehicle.setWheelFrictionSlip(i, v);
    });

    this.loadCar(scene, world);
  }

  loadCar(scene, world) {
    this.loader.load(
      'LowPolyCars.gltf',
      (gltf) => {
        const carGroup = gltf.scene;
        carGroup.rotation.y = MODEL_OFFSET_Y;
        carGroup.updateMatrixWorld(true);

        const rawWheels = [];
        carGroup.traverse((obj) => {
          if (obj.isMesh && obj.name.toLowerCase().includes('whell')) rawWheels.push(obj);
        });

        const box    = new THREE.Box3().setFromObject(carGroup);
        const center = new THREE.Vector3();
        const size   = new THREE.Vector3();
        box.getCenter(center);
        box.getSize(size);

        carGroup.position.sub(center);
        carGroup.updateMatrixWorld(true);

        const wrapper = new THREE.Group();
        wrapper.add(carGroup);
        scene.add(wrapper);

        const wheelData = rawWheels.map((w) => {
          const localBox    = new THREE.Box3().setFromBufferAttribute(w.geometry.attributes.position);
          const localCenter = new THREE.Vector3();
          localBox.getCenter(localCenter);

          const wb = new THREE.Box3().setFromObject(w);
          const wc = new THREE.Vector3();
          const ws = new THREE.Vector3();
          wb.getCenter(wc);
          wb.getSize(ws);
          const radius = Math.max(ws.x, ws.y, ws.z) * 0.5 * WHEEL_RADIUS_BIAS;
          return { mesh: w, pos: wc, radius, localCenter };
        });

        const avgZ      = wheelData.reduce((s, d) => s + d.pos.z, 0) / (wheelData.length || 1);
        const frontData = wheelData.filter(d => d.pos.z >= avgZ);
        const rearData  = wheelData.filter(d => d.pos.z <  avgZ);
        const allSorted = [...frontData, ...rearData];
        this.frontCount = frontData.length;

        allSorted.forEach(({ mesh, localCenter, radius }) => {
          mesh.geometry.translate(-localCenter.x, -localCenter.y, -localCenter.z);
          const pivot = new THREE.Object3D();
          pivot.position.copy(localCenter);
          mesh.parent.add(pivot);
          pivot.add(mesh);
          mesh.position.set(0, 0, 0);
          this.wheelPivots.push(pivot);
          this.wheelInitQuats.push(mesh.quaternion.clone());
          this.wheelRadii.push(radius);
        });

        this.wheelMeshes.front = allSorted.slice(0, this.frontCount).map(d => d.mesh);
        this.wheelMeshes.rear  = allSorted.slice(this.frontCount).map(d => d.mesh);

        // Lift only the body mesh geometry in car2-local -Z direction (= world +Y).
        // geometry.translate moves vertices only — pivots/physics are unaffected.
        carGroup.traverse(obj => {
          if (obj.isMesh && !obj.name.toLowerCase().includes('whell')) {
            obj.geometry.translate(0, 0, -MODEL_BODY_LIFT);
          }
        });

        this.carBodyGroup = carGroup;  // stored for suspension-driven hood animation

        const rigidBody = world.createRigidBody(
          RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(SPAWN.x, SPAWN.y, SPAWN.z)
            .setAngularDamping(CAR_ANGULAR_DAMPING)
            .setAdditionalMass(8.0)  // heavier chassis = harder to flip/jump
        );

        this.chassisHalf = {
          x: size.x * CHASSIS_W_FRAC / 2,
          y: size.y * CHASSIS_H_FRAC / 2,
          z: size.z * CHASSIS_L_FRAC / 2,
        };
        world.createCollider(
          RAPIER.ColliderDesc.cuboid(this.chassisHalf.x, this.chassisHalf.y, this.chassisHalf.z)
            .setTranslation(0, CHASSIS_OFFSET_Y, 0).setRestitution(0.05),
          rigidBody
        );

        const padHalf = { x: size.x * ROOF_PAD_W_FRAC / 2, y: ROOF_PAD_THICK / 2, z: size.z * ROOF_PAD_L_FRAC / 2 };
        const padCentreY = CHASSIS_OFFSET_Y + this.chassisHalf.y + padHalf.y;
        world.createCollider(
          RAPIER.ColliderDesc.cuboid(padHalf.x, padHalf.y, padHalf.z)
            .setTranslation(0, padCentreY, 0).setRestitution(0.05),
          rigidBody
        );
        // Body collision boxes as {centreY, half} in body coordinates, and the roof-side contact surface
        this.collisionBoxes = [
          { centreY: CHASSIS_OFFSET_Y, half: this.chassisHalf },
          { centreY: padCentreY, half: padHalf },
        ];
        this.roofContact = { x: padHalf.x, y: padCentreY + padHalf.y }; // half width, outer face height above the origin

        const vehicle = world.createVehicleController(rigidBody);
        vehicle.indexUpAxis      = 1;
        vehicle.setIndexForwardAxis = 2;

        const suspDir = { x: 0, y: -1, z: 0 };
        const axleDir = { x: -1, y: 0, z: 0 };

        allSorted.forEach(({ pos, radius }) => {
          vehicle.addWheel(
            { x: pos.x, y: pos.y + SUSP_REST_LEN + radius, z: pos.z },
            suspDir,
            axleDir,
            SUSP_REST_LEN,
            radius
          );
        });

        for (let i = 0; i < vehicle.numWheels(); i++) {
          vehicle.setWheelSuspensionStiffness(i, SUSP_STIFFNESS);
          vehicle.setWheelSuspensionCompression(i, SUSP_COMPRESSION);
          vehicle.setWheelSuspensionRelaxation(i, SUSP_RELAXATION);
          vehicle.setWheelMaxSuspensionTravel(i, SUSP_MAX_TRAVEL);
          vehicle.setWheelMaxSuspensionForce(i, SUSP_MAX_FORCE);
          vehicle.setWheelFrictionSlip(i, WHEEL_FRICTION_SLIP);
          vehicle.setWheelSideFrictionStiffness(i, WHEEL_SIDE_FRICTION);
        }

        this.vehicle = vehicle;
        this.car     = { mesh: wrapper, rigidBody };
        this.ready   = true;
      },
      undefined,
      (err) => console.error('Car load error:', err)
    );
  }

  prePhysicsStep(dt) {
    if (!this.ready || !this.vehicle) return;

    const fwd   = !this.inputBlocked && !!this.pressed['KeyW'];
    const back  = !this.inputBlocked && !!this.pressed['KeyS'];
    const left  = !this.inputBlocked && !!this.pressed['KeyA'];
    const right = !this.inputBlocked && !!this.pressed['KeyD'];

    const throttleActive = fwd || back;
    const rb = this.car.rigidBody;

    // On its roof the wheels cannot steer: A/D lean the car instead (the wheel update is skipped while leaning).
    // Every new press starts a short push, so a quick tap is enough; holding a key keeps pushing.
    const press = (right ? 1 : 0) - (left ? 1 : 0);
    if (press !== 0 && press !== this.lastPress) this.pulse = { dir: press, time: LEAN_PULSE_TIME };
    this.lastPress = press;
    if (this.rock.active || (press !== 0 && this._canStartLean())) {
      let push = press;
      if (this.pulse.time > 0) {
        push = this.pulse.dir;
        this.pulse.time -= dt;
      }
      this._stepLean(dt, push);
      return;
    }
    this.pulse.time = 0;

    const engineForce = fwd ? this.settings.engineForce : back ? -this.settings.engineForce : 0;
    let brake = 0;

    // Smooth stop over COAST_STOP_TIME instead of instant snap-stop.
    if (throttleActive) {
      this.wasThrottle = true;
      this.coastTimer = 0;
    } else {
      const fwd = this._forwardXZ();
      if (this.wasThrottle) {
        const lv = rb.linvel();
        this.coastStartSpeed = lv.x * fwd.x + lv.z * fwd.z; // speed along the heading at release
        this.coastTimer = 0;
        this.wasThrottle = false;
      }

      this.coastTimer = Math.min(COAST_STOP_TIME, this.coastTimer + dt);
      const k = 1 - (this.coastTimer / COAST_STOP_TIME);
      // Fade only the speed along the current heading, and damp the sideways slide. The velocity then follows
      // the heading, so steering still turns the car while it coasts.
      const lv = rb.linvel();
      const along = lv.x * fwd.x + lv.z * fwd.z;
      const sideDamp = Math.exp(-COAST_LATERAL_DAMP * dt);
      const sideX = (lv.x - fwd.x * along) * sideDamp;
      const sideZ = (lv.z - fwd.z * along) * sideDamp;
      const speed = this.coastStartSpeed * k;
      rb.setLinvel({
        x: fwd.x * speed + sideX,
        y: lv.y,
        z: fwd.z * speed + sideZ,
      }, true);

      if (this.coastTimer >= COAST_STOP_TIME) {
        brake = BRAKE_FORCE;
      }
    }

    const lvForSteer = rb.linvel();
    const hSpeed = Math.hypot(lvForSteer.x, lvForSteer.z);
    const t = THREE.MathUtils.clamp(
      (hSpeed - STEER_REDUCE_SPEED_START) / (STEER_REDUCE_SPEED_END - STEER_REDUCE_SPEED_START),
      0,
      1
    );
    const steerFactor = 1 - t * (1 - STEER_MIN_FACTOR);
    const steerAtSpeed = this.settings.maxSteer * steerFactor;
    const targetSteer = (left || right) ? (left ? 1 : -1) * steerAtSpeed : 0;
    this.steerAngle  += (targetSteer - this.steerAngle) * STEER_SMOOTHING;

    // Steering works the same while coasting as while driving; the yaw damping below limits spin-outs.
    const physicsSteer = this.steerAngle;
    if (!throttleActive) {
      const av = rb.angvel();
      const yawKeep = Math.exp(-BRAKE_YAW_DAMP_RATE * dt);
      rb.setAngvel({ x: av.x, y: av.y * yawKeep, z: av.z }, true);
    }

    for (let i = 0; i < this.vehicle.numWheels(); i++) {
      this.vehicle.setWheelEngineForce(i, engineForce);
      this.vehicle.setWheelBrake(i, brake);
      if (i < this.frontCount) {
        this.vehicle.setWheelSteering(i, physicsSteer * STEER_PHYS_SIGN);
      }
    }

    this.vehicle.updateVehicle(dt);
  }

  /** Unit vector of the car's heading (its forward axis) projected on the ground plane. */
  _forwardXZ() {
    const r = this.car.rigidBody.rotation();
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w));
    f.y = 0;
    return f.lengthSq() > 1e-8 ? f.normalize() : new THREE.Vector3(0, 0, 1);
  }

  /** True when the car's up axis points below the horizon, i.e. the car lies on its roof. */
  isUpsideDown() {
    const r = this.car.rigidBody.rotation();
    return new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w)).y < CAR_UPSIDE_DOWN_UP_Y;
  }

  /** True when the car lies on its roof and is nearly at rest, so a roof lean may start. */
  _canStartLean() {
    if (!this.isUpsideDown()) return false;
    const rb = this.car.rigidBody;
    const lv = rb.linvel();
    const av = rb.angvel();
    return Math.hypot(lv.x, lv.y, lv.z) < LEAN_START_MAX_SPEED && Math.hypot(av.x, av.y, av.z) < LEAN_START_MAX_SPEED;
  }

  /**
   * Capture the resting roof pose and the two pivot edges, and make the body kinematic.
   * The lean is then placed by the pendulum: the solver would absorb small pushes against the ground.
   */
  _startLean() {
    const rb = this.car.rigidBody;
    const t = rb.translation();
    const r = rb.rotation();
    const o0 = new THREE.Vector3(t.x, t.y, t.z);
    const q0 = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(q0); // roll axis = car forward
    const hx = this.roofContact.x; // pivot edges lie on the roof contact surface
    const face = this.roofContact.y; // its outer face, measured from the body origin

    // Pivot edge for one lean side: sideX = -1 is the car's right (lean right = D), +1 its left.
    // sgn is the roll sign that lifts the opposite edge while the pivot edge stays on the ground.
    // The centre of mass is not the body origin (chassis box and added mass), so measure the tip from the real one.
    const com = rb.localCom();
    const drop = face - com.y; // centre of mass to the roof-side face, along the body axis
    const pivotSide = (sideX) => {
      const pivot = new THREE.Vector3(sideX * hx, face, 0).applyQuaternion(q0).add(o0);
      const far = new THREE.Vector3(-sideX * hx, face, 0).applyQuaternion(q0).add(o0);
      const probe = new THREE.Quaternion().setFromAxisAngle(axis, 0.01);
      const farAfter = far.clone().sub(pivot).applyQuaternion(probe).add(pivot);
      return {
        pivot,
        sgn: farAfter.y > far.y ? 1 : -1,
        tip: Math.atan2(Math.abs(sideX * hx - com.x), drop), // lean at which the centre of mass is over the pivot edge
      };
    };

    this.rock.pose = { o0, q0, axis, right: pivotSide(-1), left: pivotSide(1) };
    this.rock.active = true;
    this.rock.rolling = false;
    this.rock.phi = 0;
    this.rock.omega = 0;
    rb.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
  }

  /**
   * One physics step of the roof lean: integrate the pendulum, then place, tip over or settle the body.
   * @param dt    fixed physics step in seconds
   * @param push  -1 (A), 0 (none) or +1 (D); D leans the car to its right
   */
  _stepLean(dt, push) {
    if (!this.rock.active) this._startLean();
    const rock = this.rock;

    if (rock.rolling) {
      rock.phi += rock.rollDir * LEAN_ROLL_SPEED * dt;
      if (Math.abs(rock.phi) >= Math.PI) return this._finishRoll();
      return this._placeLean(rock.phi);
    }

    const acc = -LEAN_STIFFNESS * rock.phi - LEAN_DAMPING * rock.omega + LEAN_PUSH * push;
    rock.omega += acc * dt;
    rock.phi += rock.omega * dt;

    const side = rock.phi >= 0 ? rock.pose.right : rock.pose.left;
    if (Math.abs(rock.phi) >= side.tip) {
      // Past the balance point the centre of mass keeps falling: roll the rest of the way onto the wheels
      rock.rolling = true;
      rock.rollDir = Math.sign(rock.phi);
      rock.omega = 0;
      return this._placeLean(rock.phi);
    }
    if (push === 0 && Math.abs(rock.phi) < LEAN_SETTLE_EPS && Math.abs(rock.omega) < LEAN_SETTLE_EPS) return this._endLean();
    this._placeLean(rock.phi);
  }

  /**
   * Body pose at lean angle phi (rad, + = right): rolled about the pivot edge that stays on the ground.
   * @returns {{o: THREE.Vector3, q: THREE.Quaternion, pivotY: number}} origin, rotation and ground height of the pivot
   */
  _leanPose(phi) {
    const { o0, q0, axis, right, left } = this.rock.pose;
    const side = phi >= 0 ? right : left;
    const R = new THREE.Quaternion().setFromAxisAngle(axis, side.sgn * Math.abs(phi));
    return {
      o: o0.clone().sub(side.pivot).applyQuaternion(R).add(side.pivot),
      q: R.clone().multiply(q0),
      pivotY: side.pivot.y,
    };
  }

  /** Put the kinematic body at lean angle phi. */
  _placeLean(phi) {
    const { o, q } = this._leanPose(phi);
    const rb = this.car.rigidBody;
    rb.setNextKinematicTranslation({ x: o.x, y: o.y, z: o.z });
    rb.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
  }

  /** Lowest world y of the body collision boxes (chassis and roof pad) in the pose (o, q). */
  _lowestCornerY(o, q) {
    let lowest = Infinity;
    for (const { centreY, half } of this.collisionBoxes) {
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        const p = new THREE.Vector3(sx * half.x, centreY + sy * half.y, sz * half.z).applyQuaternion(q).add(o);
        lowest = Math.min(lowest, p.y);
      }
    }
    return lowest;
  }

  /** Rolled over onto the wheels: lift the body so its lowest corner touches the ground, then let the solver take over. */
  _finishRoll() {
    const { o, q, pivotY } = this._leanPose(Math.PI * this.rock.rollDir);
    o.y += pivotY - this._lowestCornerY(o, q);
    this._handToSolver(o, q);
  }

  /** Lean is flat again and no key is held: return the body to the solver at its resting roof pose. */
  _endLean() {
    const { o0, q0 } = this.rock.pose;
    this._handToSolver(o0, q0);
  }

  /** Make the body dynamic again at pose (o, q) with no motion. */
  _handToSolver(o, q) {
    this.rock.active = false;
    this.rock.rolling = false;
    this.rock.phi = 0;
    this.rock.omega = 0;
    const rb = this.car.rigidBody;
    rb.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    rb.setTranslation({ x: o.x, y: o.y, z: o.z }, true);
    rb.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
    rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  _animateWheels() {
    const allWheels = [...this.wheelMeshes.front, ...this.wheelMeshes.rear];
    let suspDeltaSum = 0;
    let frontDeltaSum = 0;
    let rearDeltaSum = 0;
    let frontN = 0;
    let rearN = 0;

    allWheels.forEach((w, i) => {
      this.wheelPivots[i].rotation.z = -(i < this.frontCount ? this.steerAngle : 0);

      // Suspension travel: wheelSuspensionLength = ray distance (spring + radius),
      // so subtract radius to get pure spring delta relative to rest length.
      const rawLen = this.vehicle.wheelSuspensionLength(i) ?? (SUSP_REST_LEN + this.wheelRadii[i]);
      const suspDelta = (rawLen - this.wheelRadii[i]) - SUSP_REST_LEN;
      w.position.z = suspDelta * WHEEL_VISUAL_TRAVEL_SCALE;
      suspDeltaSum += suspDelta;
      if (i < this.frontCount) {
        frontDeltaSum += suspDelta;
        frontN++;
      } else {
        rearDeltaSum += suspDelta;
        rearN++;
      }

      const spinQ = new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.vehicle.wheelRotation(i) * WHEEL_SPIN_DIR);
      w.quaternion.copy(this.wheelInitQuats[i]).multiply(spinQ);
    });

    // Sync hood: translate carGroup in car2-local Z by avg suspension delta.
    // When wheels compress (suspDelta < 0), body sinks down — matching real suspension.
    if (this.carBodyGroup) {
      const rawTarget = (suspDeltaSum / allWheels.length) * HOOD_SYNC_SCALE;
      const target = THREE.MathUtils.clamp(rawTarget, -HOOD_SYNC_MAX, HOOD_SYNC_MAX);
      this.bodyLiftCurrent += (target - this.bodyLiftCurrent) * HOOD_SYNC_LERP;
      this.carBodyGroup.position.z = this.bodyLiftCurrent;

      // Tilt body from front-vs-rear suspension: climbing lifts the nose.
      const frontAvg = frontN ? (frontDeltaSum / frontN) : 0;
      const rearAvg = rearN ? (rearDeltaSum / rearN) : 0;
      const rawPitch = (rearAvg - frontAvg) * BODY_PITCH_SCALE;
      const pitchTarget = THREE.MathUtils.clamp(rawPitch, -BODY_PITCH_MAX, BODY_PITCH_MAX);
      this.bodyPitchCurrent += (pitchTarget - this.bodyPitchCurrent) * BODY_PITCH_LERP;
      this.carBodyGroup.rotation.x = this.bodyPitchCurrent;
    }
  }

  getMesh() { return this.ready ? this.car.mesh : null; }

  /** Put the car at a world position, facing yaw radians (0 = +z), standing still. */
  teleport(x, y, z, yaw = 0) {
    if (!this.ready) return;
    this.car.rigidBody.setTranslation({ x, y, z }, true);
    this.car.rigidBody.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    this._clearMotion();
  }

  reset() {
    this.teleport(SPAWN.x, SPAWN.y, SPAWN.z, 0);
  }

  _clearMotion() {
    const rb = this.car.rigidBody;
    if (this.rock.active) {
      this.rock.active = false;
      this.rock.rolling = false;
      rb.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    }
    this.rock.phi = 0;
    this.rock.omega = 0;
    rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
    rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.coastTimer = COAST_STOP_TIME;
    this.coastStartSpeed = 0;
    this.wasThrottle = false;
    this.bodyLiftCurrent = 0;
    this.bodyPitchCurrent = 0;
    this.steerAngle = 0;
    if (this.carBodyGroup) {
      this.carBodyGroup.position.z = 0;
      this.carBodyGroup.rotation.x = 0;
    }
    this.wheelPivots.forEach((p) => { p.rotation.z = 0; });
  }

  update(dt = 1 / 60) {
    if (!this.ready) return;
    const t = this.car.rigidBody.translation();
    const r = this.car.rigidBody.rotation();
    this.car.mesh.position.set(t.x, t.y, t.z);
    this.car.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    this._animateWheels();
  }
}
