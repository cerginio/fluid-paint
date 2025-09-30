// ES6 class version of Brush

const N_PREVIOUS_SPEEDS = 15; // how many previous speeds we store
const SPLATS_PER_SEGMENT = 8;

const VERTICES_PER_BRISTLE = 10;
const BRISTLE_LENGTH = 4.5; // relative to a scale of 1
const BRISTLE_JITTER = 0.5;

const ITERATIONS = 20;
const GRAVITY = 10.0;
const BRUSH_DAMPING = 0.75;
const STIFFNESS_VARIATION = 0.3;

// the radius of a brush is equal to the scale
class Brush {
  constructor(wgl, shaderSources, maxBristleCount) {
    this.wgl = wgl;

    this.maxBristleCount = maxBristleCount;
    this.bristleCount = maxBristleCount; // number of bristles currently being used

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
      null, wgl.CLAMP_TO_EDGE, wgl.CLAMP_TO_EDGE, wgl.LINEAR, wgl.LINEAR
    );
    this.previousPositionsTexture = wgl.buildTexture(
      wgl.RGBA, wgl.FLOAT, maxBristleCount, VERTICES_PER_BRISTLE,
      null, wgl.CLAMP_TO_EDGE, wgl.CLAMP_TO_EDGE, wgl.LINEAR, wgl.LINEAR
    );
    this.velocitiesTexture = wgl.buildTexture(
      wgl.RGBA, wgl.FLOAT, maxBristleCount, VERTICES_PER_BRISTLE,
      null, wgl.CLAMP_TO_EDGE, wgl.CLAMP_TO_EDGE, wgl.LINEAR, wgl.LINEAR
    );
    this.previousVelocitiesTexture = wgl.buildTexture(
      wgl.RGBA, wgl.FLOAT, maxBristleCount, VERTICES_PER_BRISTLE,
      null, wgl.CLAMP_TO_EDGE, wgl.CLAMP_TO_EDGE, wgl.LINEAR, wgl.LINEAR
    );
    this.projectedPositionsTexture = wgl.buildTexture(
      wgl.RGBA, wgl.FLOAT, maxBristleCount, VERTICES_PER_BRISTLE,
      null, wgl.CLAMP_TO_EDGE, wgl.CLAMP_TO_EDGE, wgl.LINEAR, wgl.LINEAR
    );
    this.projectedPositionsTextureTemp = wgl.buildTexture(
      wgl.RGBA, wgl.FLOAT, maxBristleCount, VERTICES_PER_BRISTLE,
      null, wgl.CLAMP_TO_EDGE, wgl.CLAMP_TO_EDGE, wgl.LINEAR, wgl.LINEAR
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
      randoms.push(Math.random());
    }
    this.randomsTexture = wgl.buildTexture(
      wgl.RGBA, wgl.FLOAT, maxBristleCount, VERTICES_PER_BRISTLE,
      new Float32Array(randoms), wgl.CLAMP_TO_EDGE, wgl.CLAMP_TO_EDGE, wgl.LINEAR, wgl.LINEAR
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

  // sets all the bristle vertices
  initialize(x, y, z, scale) {
    this.positionX = x;
    this.positionY = y;
    this.positionZ = z;
    this.scale = scale;

    this.speeds = [];
    for (let i = 0; i < N_PREVIOUS_SPEEDS; ++i) this.speeds.push(0);

    const wgl = this.wgl;

    const setBristlesDrawState = wgl
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
      .uniform2f('u_resolution', this.maxBristleCount, VERTICES_PER_BRISTLE)
      .uniformTexture('u_randomsTexture', 2, wgl.TEXTURE_2D, this.randomsTexture)
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

  setBristleCount(newBristleCount) {
    const wgl = this.wgl;

    // set any newly added bristles
    if (newBristleCount > this.bristleCount) {
      const setBristlesDrawState = wgl
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
        .uniform2f('u_resolution', this.maxBristleCount, VERTICES_PER_BRISTLE)
        .uniformTexture('u_randomsTexture', 2, wgl.TEXTURE_2D, this.randomsTexture)
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
    const setBristlesDrawState = wgl
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
      .uniform2f('u_resolution', this.maxBristleCount, VERTICES_PER_BRISTLE)
      .uniformTexture('u_randomsTexture', 2, wgl.TEXTURE_2D, this.randomsTexture)
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
    wgl.drawArrays(setBristlesDrawState, wgl.TRIANGLE_STRIP, 0, 4);

    // PBD iterations (distance, bending, plane constraints)
    for (let i = 0; i < ITERATIONS; ++i) {
      // base positions each iteration
      wgl.framebufferTexture2D(
        this.simulationFramebuffer,
        wgl.FRAMEBUFFER,
        wgl.COLOR_ATTACHMENT0,
        wgl.TEXTURE_2D,
        this.projectedPositionsTexture,
        0
      );
      wgl.drawArrays(setBristlesDrawState, wgl.TRIANGLE_STRIP, 0, 4);

      // distance constraints (2 passes)
      for (let pass = 0; pass < 2; ++pass) {
        const constraintDrawState = wgl
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
          .uniform1i('u_pass', pass)
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
        wgl.drawArrays(constraintDrawState, wgl.TRIANGLE_STRIP, 0, 4);
        Utilities.swap(this, 'projectedPositionsTexture', 'projectedPositionsTextureTemp');
      }

      // bending constraints (3 passes)
      for (let pass = 0; pass < 3; ++pass) {
        const constraintDrawState = wgl
          .createDrawState()
          .bindFramebuffer(this.simulationFramebuffer)
          .viewport(0, 0, this.bristleCount, VERTICES_PER_BRISTLE)
          .useProgram(this.bendingConstraintProgram)
          .uniformTexture('u_positionsTexture', 0, wgl.TEXTURE_2D, this.projectedPositionsTexture)
          .uniformTexture('u_randomsTexture', 1, wgl.TEXTURE_2D, this.randomsTexture)
          .uniform1f('u_pointCount', VERTICES_PER_BRISTLE)
          .uniform1f('u_stiffnessVariation', STIFFNESS_VARIATION)
          .uniform1i('u_pass', pass)
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
        wgl.drawArrays(constraintDrawState, wgl.TRIANGLE_STRIP, 0, 4);
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
    }

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
    wgl.drawArrays(updateVelocityDrawState, wgl.TRIANGLE_STRIP, 0, 4);

    Utilities.swap(this, 'velocitiesTexture', 'previousVelocitiesTexture');

    Utilities.swap(this, 'previousPositionsTexture', 'positionsTexture');
    Utilities.swap(this, 'positionsTexture', 'projectedPositionsTexture');
  }
}

// If using modules:
// export default Brush;
