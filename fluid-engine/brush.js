// ES6 class version of Brush

const N_PREVIOUS_SPEEDS = 15; // how many previous speeds we store
const SPLATS_PER_SEGMENT = 8;

const VERTICES_PER_BRISTLE = 10;
const BRISTLE_LENGTH = 4.5; // relative to a scale of 1
const BRISTLE_JITTER = 0.5;

/* Bristle footprint. ROUND_SIDES is any value below the shader's 3.0 cutoff:
 * it selects the original disc, which stays the default for every brush that
 * does not ask for a shape. */
const ROUND_SIDES = 0;
const MIN_BRISTLE_SIDES = 3;
const MAX_BRISTLE_SIDES = 8;

const ITERATIONS = 20;
const GRAVITY = 30.0;
const BRUSH_DAMPING = 0.75;
const STIFFNESS_VARIATION = 0.3;

// the radius of a brush is equal to the scale
class Brush {
  /**
   * @param {function} [random]  engine-owned source returning [0,1). Injected
   *   so a seeded host or test gets reproducible bristle layouts; see
   *   FluidEngine's constructor for why the engine owns it rather than Brush
   *   calling Math.random() directly.
   */
  constructor(wgl, shaderSources, maxBristleCount, random) {
    this.random = typeof random === 'function' ? random : Math.random;

    /* Drawn once per press by initialize(), never per frame, per bristle or
     * per splat -- a redraw mid-stroke would make one press wander. */
    this.strokeVariation = 0;

    /* Bristle footprint for the current press. Like strokeVariation this is
     * brush state, not per-draw state: setbristles runs again every simulation
     * step to re-pin the bristle bases, and all three call sites must agree or
     * the footprint would change shape mid-stroke. */
    this.bristleSides = ROUND_SIDES;
    this.bristleAspect = 1;
    this.bristleRotation = 0;

    this.wgl = wgl;

    this.maxBristleCount = maxBristleCount;
    this.bristleCount = maxBristleCount; // number of bristles currently being used

    // exposed so the splat shaders can do their own bristle interpolation
    // (the state textures are NEAREST -- see docs/MOBILE-GPU-BRISTLE-COLLAPSE-SPEC.md)
    this.verticesPerBristle = VERTICES_PER_BRISTLE;

    this.projectProgram = wgl.createProgram(
      shaderSources['shaders/fullscreen.vert'],
      shaderSources['shaders/project.frag']
    );

    this.distanceConstraintProgram = wgl.createProgram(
      shaderSources['shaders/fullscreen.vert'],
      shaderSources['shaders/distanceconstraint.frag']
    );

    this.planeConstraintProgram = wgl.createProgram(
      shaderSources['shaders/fullscreen.vert'],
      shaderSources['shaders/planeconstraint.frag']
    );

    this.bendingConstraintProgram = wgl.createProgram(
      shaderSources['shaders/fullscreen.vert'],
      shaderSources['shaders/bendingconstraint.frag']
    );

    this.setBristlesProgram = wgl.createProgram(
      shaderSources['shaders/fullscreen.vert'],
      shaderSources['shaders/setbristles.frag']
    );

    this.updateVelocityProgram = wgl.createProgram(
      shaderSources['shaders/fullscreen.vert'],
      shaderSources['shaders/updatevelocity.frag']
    );

    // contains bristle vertex positions (x axis = bristle, y axis = vertex index)
    this.positionsTexture = wgl.buildTexture(
      wgl.RGBA, wgl.FLOAT, maxBristleCount, VERTICES_PER_BRISTLE,
      null, wgl.CLAMP_TO_EDGE, wgl.CLAMP_TO_EDGE, wgl.NEAREST, wgl.NEAREST
    );
    this.previousPositionsTexture = wgl.buildTexture(
      wgl.RGBA, wgl.FLOAT, maxBristleCount, VERTICES_PER_BRISTLE,
      null, wgl.CLAMP_TO_EDGE, wgl.CLAMP_TO_EDGE, wgl.NEAREST, wgl.NEAREST
    );
    this.velocitiesTexture = wgl.buildTexture(
      wgl.RGBA, wgl.FLOAT, maxBristleCount, VERTICES_PER_BRISTLE,
      null, wgl.CLAMP_TO_EDGE, wgl.CLAMP_TO_EDGE, wgl.NEAREST, wgl.NEAREST
    );
    this.previousVelocitiesTexture = wgl.buildTexture(
      wgl.RGBA, wgl.FLOAT, maxBristleCount, VERTICES_PER_BRISTLE,
      null, wgl.CLAMP_TO_EDGE, wgl.CLAMP_TO_EDGE, wgl.NEAREST, wgl.NEAREST
    );
    this.projectedPositionsTexture = wgl.buildTexture(
      wgl.RGBA, wgl.FLOAT, maxBristleCount, VERTICES_PER_BRISTLE,
      null, wgl.CLAMP_TO_EDGE, wgl.CLAMP_TO_EDGE, wgl.NEAREST, wgl.NEAREST
    );
    this.projectedPositionsTextureTemp = wgl.buildTexture(
      wgl.RGBA, wgl.FLOAT, maxBristleCount, VERTICES_PER_BRISTLE,
      null, wgl.CLAMP_TO_EDGE, wgl.CLAMP_TO_EDGE, wgl.NEAREST, wgl.NEAREST
    );


    // texture coordinates for each (bristle, vertex)
    const brushTextureCoordinates = [];
    for (let bristle = 0; bristle < maxBristleCount; ++bristle) {
      for (let vertex = 0; vertex < VERTICES_PER_BRISTLE; ++vertex) {
        const tx = (bristle + 0.5) / maxBristleCount;
        const ty = (vertex + 0.5) / VERTICES_PER_BRISTLE;
        brushTextureCoordinates.push(tx, ty);
      }
    }
    console.log(brushTextureCoordinates);
    this.brushTextureCoordinatesBuffer = wgl.createBuffer();
    wgl.bufferData(
      this.brushTextureCoordinatesBuffer,
      wgl.ARRAY_BUFFER,
      new Float32Array(brushTextureCoordinates),
      wgl.STATIC_DRAW
    );

    // randoms texture
    const randoms = [];
    for (let i = 0; i < maxBristleCount * VERTICES_PER_BRISTLE * 4; ++i) {
      randoms.push(this._nextRandom());
    }
    this.randomsTexture = wgl.buildTexture(
      wgl.RGBA, wgl.FLOAT, maxBristleCount, VERTICES_PER_BRISTLE,
      new Float32Array(randoms), wgl.CLAMP_TO_EDGE, wgl.CLAMP_TO_EDGE, wgl.NEAREST, wgl.NEAREST
    );

    // splat mesh (quads per segment)
    const splatCoordinates = [];
    const splatIndices = [];
    let splatIndex = 0;

    for (let bristle = 0; bristle < maxBristleCount; ++bristle) {
      for (let vertex = 0; vertex < VERTICES_PER_BRISTLE - 1; ++vertex) {
        for (let i = 0; i < SPLATS_PER_SEGMENT; ++i) {
          const t = (i + 0.5) / SPLATS_PER_SEGMENT;
          const tx = (bristle + 0.5) / maxBristleCount;
          const ty = (vertex + 0.5 + t) / VERTICES_PER_BRISTLE;

          // bottom-left
          splatCoordinates.push(tx, ty, -1, -1);
          // bottom-right
          splatCoordinates.push(tx, ty, 1, -1);
          // top-right
          splatCoordinates.push(tx, ty, 1, 1);
          // top-left
          splatCoordinates.push(tx, ty, -1, 1);

          splatIndices.push(splatIndex + 0, splatIndex + 1, splatIndex + 2);
          splatIndices.push(splatIndex + 2, splatIndex + 3, splatIndex + 0);

          splatIndex += 4;
        }
      }
    }

    this.splatCoordinatesBuffer = wgl.createBuffer();
    wgl.bufferData(
      this.splatCoordinatesBuffer,
      wgl.ARRAY_BUFFER,
      new Float32Array(splatCoordinates),
      wgl.STATIC_DRAW
    );

    this.splatIndexBuffer = wgl.createBuffer();
    wgl.bufferData(
      this.splatIndexBuffer,
      wgl.ELEMENT_ARRAY_BUFFER,
      new Uint16Array(splatIndices),
      wgl.STATIC_DRAW
    );

    this.splatIndexCount = splatIndices.length;

    // line indices for wireframe brush visualization
    const brushIndices = [];
    this.indexCount = 0;
    for (let bristle = 0; bristle < maxBristleCount; ++bristle) {
      for (let vertex = 0; vertex < VERTICES_PER_BRISTLE - 1; ++vertex) {
        const left = bristle * VERTICES_PER_BRISTLE + vertex;
        const right = bristle * VERTICES_PER_BRISTLE + vertex + 1;
        brushIndices.push(left, right);
        this.indexCount += 2;
      }
    }

    this.brushIndexBuffer = wgl.createBuffer();
    wgl.bufferData(
      this.brushIndexBuffer,
      wgl.ELEMENT_ARRAY_BUFFER,
      new Uint16Array(brushIndices),
      wgl.STATIC_DRAW
    );

    this.simulationFramebuffer = wgl.createFramebuffer();

    this.quadVertexBuffer = wgl.createBuffer();
    wgl.bufferData(
      this.quadVertexBuffer,
      wgl.ARRAY_BUFFER,
      new Float32Array([-1.0, -1.0, -1.0, 1.0, 1.0, -1.0, 1.0, 1.0]),
      wgl.STATIC_DRAW
    );
  }

  /**
   * One draw from the engine-owned source, validated.
   *
   * A bad injected generator must fail loudly here rather than silently fall
   * back to Math.random(): a test that thinks it is seeded but is not would
   * report false reproducibility, which is worse than a crash.
   */
  _nextRandom() {
    const value = this.random();
    if (typeof value !== 'number' || !isFinite(value) || value < 0 || value >= 1) {
      const error = new Error(
        'FluidEngine: the injected random() returned ' + value +
        '; expected a finite number in [0, 1).'
      );
      error.name = 'RandomSourceError';
      throw error;
    }
    return value;
  }

  /**
   * Choose the bristle footprint for subsequent presses.
   *
   * `null` (or a side count below 3) restores the round default. Sides are
   * clamped to 3..8: below 3 there is no polygon, and past 8 the shape is
   * indistinguishable from a disc once splatRadius rounds its corners.
   *
   * This does not redraw the bristles -- initialize() does, on the next press.
   * Changing the footprint mid-stroke would deform an already-settled brush
   * against its own distance constraints.
   */
  setBristleShape(shape) {
    if (!shape) {
      this.bristleSides = ROUND_SIDES;
      this.bristleAspect = 1;
      this.bristleRotation = 0;
      return;
    }
    const { sides, aspect = 1, rotation = 0 } = shape;
    if (!isFinite(sides) || sides < MIN_BRISTLE_SIDES) {
      this.bristleSides = ROUND_SIDES;
      this.bristleAspect = 1;
      this.bristleRotation = 0;
      return;
    }
    if (!isFinite(aspect) || aspect <= 0) {
      throw new RangeError('FluidEngine: bristle shape aspect must be a positive finite number.');
    }
    if (!isFinite(rotation)) {
      throw new RangeError('FluidEngine: bristle shape rotation must be a finite number.');
    }
    this.bristleSides = Math.min(MAX_BRISTLE_SIDES, Math.round(sides));
    this.bristleAspect = aspect;
    this.bristleRotation = rotation;
  }

  /**
   * Apply the footprint uniforms to a setbristles draw state.
   *
   * Every setbristles call site must use this: the per-step base re-pin
   * (updateBrush) reseeds row 0 from the same shader, so a site that omitted
   * these uniforms would silently reset that press's footprint to round.
   */
  _uniformBristleShape(drawState) {
    return drawState
      .uniform1f('u_bristleSides', this.bristleSides)
      .uniform1f('u_bristleAspect', this.bristleAspect)
      .uniform1f('u_bristleRotation', this.bristleRotation);
  }

  // sets all the bristle vertices
  //
  // Also draws this press's bristle-layout variation (Phase 8a). Every call is
  // a new press: the caller of the low-level primitive owns that decision, and
  // FluidEngine.beginStroke() calls this exactly once per stroke.
  initialize(x, y, z, scale, resetDynamics = false) {
    this.strokeVariation = this._nextRandom();

    this.positionX = x;
    this.positionY = y;
    this.positionZ = z;
    this.scale = scale;

    this.speeds = [];
    for (let i = 0; i < N_PREVIOUS_SPEEDS; ++i) this.speeds.push(0);

    const wgl = this.wgl;

    const setBristlesDrawState = this._uniformBristleShape(wgl
      .createDrawState()
      .bindFramebuffer(this.simulationFramebuffer)
      .viewport(0, 0, this.bristleCount, VERTICES_PER_BRISTLE)
      .useProgram(this.setBristlesProgram)
      .uniform3f('u_brushPosition', this.positionX, this.positionY, this.positionZ)
      .uniform1f('u_brushScale', this.scale)
      .uniform1f('u_bristleCount', this.bristleCount)
      .uniform1f('u_bristleLength', BRISTLE_LENGTH)
      .uniform1f('u_verticesPerBristle', VERTICES_PER_BRISTLE)
      .uniform1f('u_jitter', BRISTLE_JITTER)
      .uniform1f('u_strokeVariation', this.strokeVariation)
      .uniform2f('u_resolution', this.maxBristleCount, VERTICES_PER_BRISTLE)
      .uniformTexture('u_randomsTexture', 2, wgl.TEXTURE_2D, this.randomsTexture))
      .vertexAttribPointer(
        this.quadVertexBuffer,
        this.setBristlesProgram.getAttribLocation('a_position'),
        2,
        wgl.FLOAT,
        false,
        0,
        0
      );

    wgl.framebufferTexture2D(
      this.simulationFramebuffer,
      wgl.FRAMEBUFFER,
      wgl.COLOR_ATTACHMENT0,
      wgl.TEXTURE_2D,
      this.positionsTexture,
      0
    );
    wgl.drawArrays(setBristlesDrawState, wgl.TRIANGLE_STRIP, 0, 4);
    if (resetDynamics) {
      wgl.framebufferTexture2D(this.simulationFramebuffer, wgl.FRAMEBUFFER,
        wgl.COLOR_ATTACHMENT0, wgl.TEXTURE_2D, this.previousPositionsTexture, 0);
      wgl.drawArrays(setBristlesDrawState, wgl.TRIANGLE_STRIP, 0, 4);
      for (const texture of [this.velocitiesTexture, this.previousVelocitiesTexture]) {
        wgl.framebufferTexture2D(this.simulationFramebuffer, wgl.FRAMEBUFFER,
          wgl.COLOR_ATTACHMENT0, wgl.TEXTURE_2D, texture, 0);
        wgl.clear(wgl.createClearState().bindFramebuffer(this.simulationFramebuffer), wgl.COLOR_BUFFER_BIT);
      }
    }
  }

  setBristleCount(newBristleCount) {
    const wgl = this.wgl;

    // set any newly added bristles
    if (newBristleCount > this.bristleCount) {
      const setBristlesDrawState = this._uniformBristleShape(wgl
        .createDrawState()
        .bindFramebuffer(this.simulationFramebuffer)
        .viewport(this.bristleCount, 0, newBristleCount - this.bristleCount, VERTICES_PER_BRISTLE)
        .useProgram(this.setBristlesProgram)
        .uniform3f('u_brushPosition', this.positionX, this.positionY, this.positionZ)
        .uniform1f('u_brushScale', this.scale)
        .uniform1f('u_bristleCount', this.bristleCount)
        .uniform1f('u_bristleLength', BRISTLE_LENGTH)
        .uniform1f('u_verticesPerBristle', VERTICES_PER_BRISTLE)
        .uniform1f('u_jitter', BRISTLE_JITTER)
        .uniform1f('u_strokeVariation', this.strokeVariation)
        .uniform2f('u_resolution', this.maxBristleCount, VERTICES_PER_BRISTLE)
        .uniformTexture('u_randomsTexture', 2, wgl.TEXTURE_2D, this.randomsTexture))
        .vertexAttribPointer(
          this.quadVertexBuffer,
          this.setBristlesProgram.getAttribLocation('a_position'),
          2,
          wgl.FLOAT,
          false,
          0,
          0
        );

      wgl.framebufferTexture2D(
        this.simulationFramebuffer,
        wgl.FRAMEBUFFER,
        wgl.COLOR_ATTACHMENT0,
        wgl.TEXTURE_2D,
        this.positionsTexture,
        0
      );

      wgl.drawArrays(setBristlesDrawState, wgl.TRIANGLE_STRIP, 0, 4);
    }

    this.bristleCount = newBristleCount;
  }

  // max of last N_PREVIOUS_SPEEDS speeds
  getFilteredSpeed() {
    return this.speeds.reduce((a, b) => Math.max(a, b));
  }

  update(x, y, z, scale) {
    const dx = x - this.positionX;
    const dy = y - this.positionY;
    const dz = z - this.positionZ;

    const speed = Math.sqrt(dx * dx + dy * dy + dz * dz);

    this.speeds.shift();
    this.speeds.push(speed);

    this.positionX = x;
    this.positionY = y;
    this.positionZ = z;
    this.scale = scale;

    const wgl = this.wgl;

    // project current state (integrate gravity & damping)
    const projectDrawState = wgl
      .createDrawState()
      .bindFramebuffer(this.simulationFramebuffer)
      .viewport(0, 0, this.bristleCount, VERTICES_PER_BRISTLE)
      .useProgram(this.projectProgram)
      .uniformTexture('u_positionsTexture', 0, wgl.TEXTURE_2D, this.positionsTexture)
      .uniformTexture('u_velocitiesTexture', 1, wgl.TEXTURE_2D, this.velocitiesTexture)
      .uniformTexture('u_randomsTexture', 2, wgl.TEXTURE_2D, this.randomsTexture)
      .uniform1f('u_gravity', GRAVITY)
      .uniform1f('u_damping', BRUSH_DAMPING)
      .uniform1f('u_verticesPerBristle', VERTICES_PER_BRISTLE)
      .uniform2f('u_resolution', this.maxBristleCount, VERTICES_PER_BRISTLE)
      .vertexAttribPointer(
        this.quadVertexBuffer,
        this.projectProgram.getAttribLocation('a_position'),
        2,
        wgl.FLOAT,
        false,
        0,
        0
      );

    wgl.framebufferTexture2D(
      this.simulationFramebuffer,
      wgl.FRAMEBUFFER,
      wgl.COLOR_ATTACHMENT0,
      wgl.TEXTURE_2D,
      this.projectedPositionsTexture,
      0
    );
    wgl.drawArrays(projectDrawState, wgl.TRIANGLE_STRIP, 0, 4);


    // set bristle bases (first vertex/row)
    const setBristlesDrawState = this._uniformBristleShape(wgl
      .createDrawState()
      .bindFramebuffer(this.simulationFramebuffer)
      .viewport(0, 0, this.bristleCount, 1)
      .useProgram(this.setBristlesProgram)
      .uniform3f('u_brushPosition', this.positionX, this.positionY, this.positionZ)
      .uniform1f('u_brushScale', this.scale)
      .uniform1f('u_bristleCount', this.bristleCount)
      .uniform1f('u_bristleLength', BRISTLE_LENGTH)
      .uniform1f('u_jitter', BRISTLE_JITTER)
      .uniform1f('u_verticesPerBristle', VERTICES_PER_BRISTLE)
      .uniform1f('u_strokeVariation', this.strokeVariation)
      .uniform2f('u_resolution', this.maxBristleCount, VERTICES_PER_BRISTLE)
      .uniformTexture('u_randomsTexture', 2, wgl.TEXTURE_2D, this.randomsTexture))
      .vertexAttribPointer(
        this.quadVertexBuffer,
        this.setBristlesProgram.getAttribLocation('a_position'),
        2,
        wgl.FLOAT,
        false,
        0,
        0
      );

    wgl.framebufferTexture2D(
      this.simulationFramebuffer,
      wgl.FRAMEBUFFER,
      wgl.COLOR_ATTACHMENT0,
      wgl.TEXTURE_2D,
      this.projectedPositionsTexture,
      0
    );
    wgl.drawArrays(setBristlesDrawState, wgl.TRIANGLE_STRIP, 0, 4); //OK, verified







    // PBD iterations (distance, bending, plane constraints)
    for (let i = 0; i < ITERATIONS; ++i) {// >> iterations loop
      // base positions each iteration
      wgl.framebufferTexture2D(
        this.simulationFramebuffer,
        wgl.FRAMEBUFFER,
        wgl.COLOR_ATTACHMENT0,
        wgl.TEXTURE_2D,
        this.projectedPositionsTexture,
        0
      );
      wgl.drawArrays(setBristlesDrawState, wgl.TRIANGLE_STRIP, 0, 4);// OK, verified

      // distance constraints (2 passes)
      for (let distPass = 0; distPass < 2; ++distPass) {
        const distConstraintDrawState = wgl
          .createDrawState()
          .bindFramebuffer(this.simulationFramebuffer)
          .viewport(0, 0, this.bristleCount, VERTICES_PER_BRISTLE)
          .useProgram(this.distanceConstraintProgram)
          .uniformTexture('u_positionsTexture', 0, wgl.TEXTURE_2D, this.projectedPositionsTexture)
          .uniform1f('u_pointCount', VERTICES_PER_BRISTLE)
          .uniform1f(
            'u_targetDistance',
            (this.scale * BRISTLE_LENGTH) / (VERTICES_PER_BRISTLE - 1)
          )
          .uniform1i('u_pass', distPass)
          .uniform2f('u_resolution', this.maxBristleCount, VERTICES_PER_BRISTLE)
          .vertexAttribPointer(
            this.quadVertexBuffer,
            this.distanceConstraintProgram.getAttribLocation('a_position'),
            2,
            wgl.FLOAT,
            false,
            0,
            0
          );

        wgl.framebufferTexture2D(
          this.simulationFramebuffer,
          wgl.FRAMEBUFFER,
          wgl.COLOR_ATTACHMENT0,
          wgl.TEXTURE_2D,
          this.projectedPositionsTextureTemp,
          0
        );
        wgl.drawArrays(distConstraintDrawState, wgl.TRIANGLE_STRIP, 0, 4); // OK, verified
        Utilities.swap(this, 'projectedPositionsTexture', 'projectedPositionsTextureTemp');
      }

      // bending constraints (3 passes)
      for (let bendPass = 0; bendPass < 3; ++bendPass) {
        const bendConstraintDrawState = wgl
          .createDrawState()
          .bindFramebuffer(this.simulationFramebuffer)
          .viewport(0, 0, this.bristleCount, VERTICES_PER_BRISTLE)
          .useProgram(this.bendingConstraintProgram)
          .uniformTexture('u_positionsTexture', 0, wgl.TEXTURE_2D, this.projectedPositionsTexture)
          .uniformTexture('u_randomsTexture', 1, wgl.TEXTURE_2D, this.randomsTexture)
          .uniform1f('u_pointCount', VERTICES_PER_BRISTLE)
          .uniform1f('u_stiffnessVariation', STIFFNESS_VARIATION)
          .uniform1i('u_pass', bendPass)
          .uniform2f('u_resolution', this.maxBristleCount, VERTICES_PER_BRISTLE)
          .vertexAttribPointer(
            this.quadVertexBuffer,
            this.bendingConstraintProgram.getAttribLocation('a_position'),
            2,
            wgl.FLOAT,
            false,
            0,
            0
          );

        wgl.framebufferTexture2D(
          this.simulationFramebuffer,
          wgl.FRAMEBUFFER,
          wgl.COLOR_ATTACHMENT0,
          wgl.TEXTURE_2D,
          this.projectedPositionsTextureTemp,
          0
        );
        wgl.drawArrays(bendConstraintDrawState, wgl.TRIANGLE_STRIP, 0, 4);
        Utilities.swap(this, 'projectedPositionsTexture', 'projectedPositionsTextureTemp');
      }

      // plane constraint
      const planeConstraintDrawState = wgl
        .createDrawState()
        .bindFramebuffer(this.simulationFramebuffer)
        .viewport(0, 0, this.bristleCount, VERTICES_PER_BRISTLE)
        .useProgram(this.planeConstraintProgram)
        .uniformTexture('u_positionsTexture', 0, wgl.TEXTURE_2D, this.projectedPositionsTexture)
        .uniform2f('u_resolution', this.maxBristleCount, VERTICES_PER_BRISTLE)
        .vertexAttribPointer(
          this.quadVertexBuffer,
          this.planeConstraintProgram.getAttribLocation('a_position'),
          2,
          wgl.FLOAT,
          false,
          0,
          0
        );

      wgl.framebufferTexture2D(
        this.simulationFramebuffer,
        wgl.FRAMEBUFFER,
        wgl.COLOR_ATTACHMENT0,
        wgl.TEXTURE_2D,
        this.projectedPositionsTextureTemp,
        0
      );
      wgl.drawArrays(planeConstraintDrawState, wgl.TRIANGLE_STRIP, 0, 4);
      Utilities.swap(this, 'projectedPositionsTexture', 'projectedPositionsTextureTemp');
    }// << iterations loop

    // update velocities from old vs projected positions
    const updateVelocityDrawState = wgl
      .createDrawState()
      .bindFramebuffer(this.simulationFramebuffer)
      .viewport(0, 0, this.bristleCount, VERTICES_PER_BRISTLE)
      .useProgram(this.updateVelocityProgram)
      .uniformTexture('u_positionsTexture', 0, wgl.TEXTURE_2D, this.positionsTexture)
      .uniformTexture('u_projectedPositionsTexture', 1, wgl.TEXTURE_2D, this.projectedPositionsTexture)
      .uniform2f('u_resolution', this.maxBristleCount, VERTICES_PER_BRISTLE)
      .vertexAttribPointer(
        this.quadVertexBuffer,
        this.updateVelocityProgram.getAttribLocation('a_position'),
        2,
        wgl.FLOAT,
        false,
        0,
        0
      );

    wgl.framebufferTexture2D(
      this.simulationFramebuffer,
      wgl.FRAMEBUFFER,
      wgl.COLOR_ATTACHMENT0,
      wgl.TEXTURE_2D,
      this.previousVelocitiesTexture,
      0
    );
    wgl.drawArrays(updateVelocityDrawState, wgl.TRIANGLE_STRIP, 0, 4);// OK, verified

    Utilities.swap(this, 'velocitiesTexture', 'previousVelocitiesTexture');

    Utilities.swap(this, 'previousPositionsTexture', 'positionsTexture');
    Utilities.swap(this, 'positionsTexture', 'projectedPositionsTexture');

    const brushScale = this.brushScale; // whatever you pass into shaders
    const bristleLen = BRISTLE_LENGTH;


    // const texW = this.maxBristleCount; // texture width  = bristles
    // const texH = VERTICES_PER_BRISTLE; // texture height = segments per bristle
    // this.dbg.showPositions(this.positionsTexture, texW, texH, brushScale, bristleLen);

    debugTexture(this.velocitiesTexture, 2);
    // debugTexture(this.positionsTexture, 1);
    // debugTexture(this.projectedPositionsTexture, 1);

    function debugTexture(velocitiesTexture, mode = 1) {
      // `typeof presenter` rather than `presenter`: `presenter` is index.html's
      // own global (`let presenter;`), not the engine's. A host that never
      // declares it hits a ReferenceError here, inside update() -- every frame
      // of every stroke -- which unwinds BEFORE splat() runs, so the host
      // paints nothing while everything else looks healthy. `typeof` is
      // defined for undeclared identifiers, so this asks "is there a
      // presenter" without requiring the host to declare one. Do not
      // "simplify" it back: the engine must not require a global its host
      // never heard of.
      if (typeof presenter !== 'undefined' && presenter) {
        presenter.presentTextureToCanvas2D({
          srcTexture: velocitiesTexture,
          debugCanvas,
          mode: mode, // velocity view
          scaleXY: brushScale, // or an appropriate velocity scale
          scaleZ: bristleLen
        });
      }
    }


  }
}

// If using modules:
// export default Brush;
