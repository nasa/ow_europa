#version 130

// variable prefixes to indicate coordinate systems:
// os = object space
// ws = world space
// vs = view space
// ls = light space

// params bound by Ogre
in vec4 position;
in vec3 normal;
in vec2 uv0;

uniform mat4 worldMatrix;
uniform mat4 worldViewMatrix;
uniform mat4 worldViewProjMatrix;
uniform mat4 inverseViewMatrix;
uniform mat4 inverseTransposeWorldMatrix;
uniform mat4 inverseTransposeWorldViewMatrix;

uniform vec4 wsSunPosition;

// Shadow parameters
uniform mat4 texViewProjMatrix0;
uniform mat4 texViewProjMatrix1;
uniform mat4 texViewProjMatrix2;
out vec4 lsPos0;
out vec4 lsPos1;
out vec4 lsPos2;

// output
out vec3 wsPos;
out vec3 wsNormal;
out vec3 wsVecToEye;
out vec2 wsHeightmapUV;
out vec3 vsPos;
out vec3 vsNormal;
out mat3 normalMatrix;
out vec3 vsVecToSun;

void main()
{
  vsPos = vec3(worldViewMatrix * position);

  wsPos = vec3(worldMatrix * position);
  wsNormal = mat3(inverseTransposeWorldMatrix) * normal;
  wsVecToEye = vec3(inverseViewMatrix[3]) - wsPos;
  wsHeightmapUV = uv0;

  normalMatrix = mat3(inverseTransposeWorldViewMatrix);

  vsNormal = normalMatrix * normal;
  vsVecToSun = normalMatrix * normalize(wsSunPosition.xyz);

  // PSSM shadows
  vec4 worldPosition = worldMatrix * position;
  lsPos0 = texViewProjMatrix0 * worldPosition;
  lsPos1 = texViewProjMatrix1 * worldPosition;
  lsPos2 = texViewProjMatrix2 * worldPosition;

  gl_Position = worldViewProjMatrix * position;
}
