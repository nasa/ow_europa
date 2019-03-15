#version 130

// variable prefixes to indicate coordinate systems:
// os = object space
// ws = world space
// vs = view space
// ls = light space

in vec3 wsPos;
in vec3 wsNormal;
in vec3 wsVecToEye;
in vec2 wsHeightmapUV;
in vec3 vsPos;
in vec3 vsNormal;
in mat3 normalMatrix;
in vec3 vsVecToSun;

// required by Gazebo to modify UVs for split DEMs
uniform mat4 uvTransform;

uniform vec4 wsSunPosition;

// Shadow parameters
uniform vec4 pssmSplitPoints;
uniform sampler2DShadow shadowMap0;
uniform sampler2DShadow shadowMap1;
uniform sampler2DShadow shadowMap2;
uniform float inverseShadowmapSize0;
uniform float inverseShadowmapSize1;
uniform float inverseShadowmapSize2;
in vec4 lsPos0;
in vec4 lsPos1;
in vec4 lsPos2;

uniform samplerCube irradianceMap;
uniform sampler2D normalMap;
uniform sampler2D detailNormalHeightMap;
//uniform float exposureMultiplier;
//uniform float gammaCorrection;

// output
out vec4 outputCol;

// Blend normals using Reoriented Normal Mapping.
// Using RNM method from http://blog.selfshadow.com/publications/blending-in-detail
// but modified to assume normals are already unpacked from texture. Also using
// detailStrength to modulate detail normals strength.
vec3 blendNormals(vec3 baseNormal, vec3 detailNormal, float detailStrength)
{
  vec3 newDetailNormal = mix(vec3(0.0, 0.0, 1.0), detailNormal, detailStrength);
  vec3 t = baseNormal + vec3(0.0, 0.0, 1.0);
  vec3 u = newDetailNormal * vec3(-1.0, -1.0, 1.0);
  return normalize((t / t.z) * dot(t, u) - u);
}

float calcDepthShadow(sampler2DShadow shadowMap, vec4 uv, float invShadowMapSize)
{
  // Remove shadow outside shadow maps so that all that area appears lit
  if (uv.z < 0.0 || uv.z > 1.0)
    return 1.0;

  // Debug code that shows a checkerboard pattern where shadow maps are projected
  //float checker = (mod(floor(uv.x * 40.0) + floor(uv.y * 40.0), 2.0) < 1.0) ? 0.5 : 1.0;
  //return texture(shadowMap, uv.xyz) * checker;

  float shadow = 0.0;

  // 9-sample poisson disk blur
  vec2 poissonDisk[9] = vec2[](
    vec2( 0.0, 0.0 ), 
    vec2( -0.987330103927, 0.127316674408 ), 
    vec2( -0.168435664837, -0.923511462813 ), 
    vec2( 0.637490968702, 0.633257405393 ), 
    vec2( 0.887653811523, -0.295636257708 ), 
    vec2( 0.516231382947, 0.0664456533132 ), 
    vec2( -0.408070991576, -0.332409120252 ), 
    vec2( -0.491072397165, 0.263378713033 ), 
    vec2( 0.0606228609526, 0.851023996335 )
  );
  for (int i = 0; i < 9; i++)
  {
    vec4 newUV = uv;
    newUV.xy += poissonDisk[i] * invShadowMapSize;
    newUV = newUV / newUV.w;
    shadow += texture(shadowMap, newUV.xyz);
  }
  shadow /= 9.0;

  return smoothstep(0.0, 1.0, shadow);
}

float calcPSSMDepthShadow(
  sampler2DShadow shadowMap0, sampler2DShadow shadowMap1, sampler2DShadow shadowMap2,
  vec4 lsPos0, vec4 lsPos1, vec4 lsPos2,
  float invShadowmapSize0, float invShadowmapSize1, float invShadowmapSize2,
  vec4 pssmSplitPoints, float camDepth)
{
  float shadow = 1.0;
  // calculate shadow
  if (camDepth <= pssmSplitPoints.x)
  {
    shadow = calcDepthShadow(shadowMap0, lsPos0, invShadowmapSize0);
  }
  else if (camDepth <= pssmSplitPoints.y)
  {
    shadow = calcDepthShadow(shadowMap1, lsPos1, invShadowmapSize1);
  }
  else
  {
    shadow = calcDepthShadow(shadowMap2, lsPos2, invShadowmapSize2);
  }
  return shadow;
}

float calcPSSMDepthShadowDebug(
  sampler2DShadow shadowMap0, sampler2DShadow shadowMap1, sampler2DShadow shadowMap2,
  vec4 lsPos0, vec4 lsPos1, vec4 lsPos2,
  float invShadowmapSize0, float invShadowmapSize1, float invShadowmapSize2,
  vec4 pssmSplitPoints, float camDepth)
{
  float shadow = 1.0;
  // calculate shadow
  shadow = calcDepthShadow(shadowMap0, lsPos0, invShadowmapSize0);
  return shadow;
}

void lighting(vec3 wsVecToSun, vec3 wsVecToEye, vec3 wsNormal, vec4 wsDetailNormalHeight, out vec3 diffuse, out vec3 specular)
{
  // shadows
  float shadow = calcPSSMDepthShadow(shadowMap0, shadowMap1, shadowMap2,
                                     lsPos0, lsPos1, lsPos2,
                                     inverseShadowmapSize0, inverseShadowmapSize1, inverseShadowmapSize2,
                                     pssmSplitPoints, -vsPos.z);

  // Only the highest parts of bumps should be lit when sun is at glancing angles
  // This removes a great deal of impossible light in shaded areas and hides shadow artifacts.
  float surfaceDot = dot(wsNormal, wsVecToSun);
  float heightMultiplier = clamp((wsDetailNormalHeight.w * 5.0 + 5.0) - (10.0 - surfaceDot * 50.0), 0.0, 1.0);

  // directional light diffuse
  float sundiffuse = max(dot(wsDetailNormalHeight.xyz, wsVecToSun), 0.0);
  diffuse += vec3(sundiffuse, sundiffuse, sundiffuse) * (heightMultiplier * shadow);

  // directional light specular
  vec3 reflectvec = reflect(-wsVecToEye, wsDetailNormalHeight.xyz);
  float sunspec = pow(max(dot(wsVecToSun, reflectvec), 0.0), 100.0);
  specular += vec3(sunspec, sunspec, sunspec) * (heightMultiplier * shadow);

  // irradiance diffuse (area light source simulation)
  // Gazebo is z-up but Ogre is y-up. Must rotate before cube texture lookup.
  // OpenGL cubemaps are arranged using RenderMan's left-handed coordinate system
  // resulting in the entire map being mirrored when rendered looking out from
  // the center, so we also negate y to correct our cube texture lookups.
  vec3 wsNormal_gazebo2ogre_and_mirrored = vec3(wsDetailNormalHeight.x, wsDetailNormalHeight.z, wsDetailNormalHeight.y);
  diffuse += texture(irradianceMap, wsNormal_gazebo2ogre_and_mirrored).rgb * wsDetailNormalHeight.w;

  // irradiance specular (area light source simulation)
  //vec3 reflectvec_gazebo2ogre_and_mirrored = vec3(reflectvec.x, reflectvec.z, reflectvec.y);
  // TODO: Use a specular map and use textureLod() to correlate roughness with a specific mipmap level
  //specular += texture(irradianceMap, reflectvec_gazebo2ogre_and_mirrored).rgb;
}

void main()
{
  //vec3 wsNormalNormalized = normalize(wsNormal);
  //vec3 vsNormalNormalized = normalize(vsNormal);
  //vec3 vsVecToEye = normalize(-vsPos);

  vec2 newUV = (uvTransform * vec4(wsHeightmapUV, 0.0f, 1.0f)).xy;

  vec3 normal = texture(normalMap, newUV).xyz * 2.0 - 1.0;
  vec4 detailNormalHeight1 = texture(detailNormalHeightMap, wsPos.xy * 0.1) * vec4(2.0, 2.0, 2.0, 1.0) - vec4(1.0, 1.0, 1.0, 0.0);
  vec4 detailNormalHeight2 = texture(detailNormalHeightMap, wsPos.xy * 0.971) * vec4(2.0, 2.0, 2.0, 1.0) - vec4(1.0, 1.0, 1.0, 0.0);
  vec3 wsFinalNormal = blendNormals(normal, blendNormals(detailNormalHeight1.xyz, detailNormalHeight2.xyz, 1.0), 1.0);
  float finalHeight = detailNormalHeight1.a * 0.9 + detailNormalHeight2.a * 0.1;

  vec3 diffuse = vec3(0, 0, 0);
  vec3 specular = vec3(0, 0, 0);
  lighting(normalize(wsSunPosition.xyz), normalize(wsVecToEye), normal, vec4(wsFinalNormal.xyz, finalHeight), diffuse, specular);

  // Europa albedo from here https://www.space.com/15498-europa-sdcmp.html is 0.64
  // In the future we might want to apply this term partially or fully with texture maps.
  diffuse *= vec3(0.6, 0.6, 0.68);
  // specular is currently just a guess
  specular *= 0.2;

  outputCol = vec4(diffuse + specular, 1.0);
}
