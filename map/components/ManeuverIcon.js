// src/components/ManeuverIcon.js
import React from 'react';
import { View } from 'react-native';
import Svg, { G, Path, Circle, Text as SvgText } from 'react-native-svg';

/**
 * type: 'straight' | 'left' | 'right' | 'slight_left' | 'slight_right'
 *       'sharp_left' | 'sharp_right' | 'uturn_left' | 'uturn_right'
 *       'merge_left' | 'merge_right' | 'fork_left' | 'fork_right'
 *       'roundabout'
 */
export default function ManeuverIcon({
  type = 'straight',
  size = 28,
  active = true,
  exitNumber, // only for roundabout
}) {
  const stroke = active ? '#1976D2' : '#9E9E9E';
  const fill = 'none';
  const strokeWidth = 2.5;

  // Base straight arrow path pointing up; we rotate as needed.
  const ArrowHead = ({ rotation = 0 }) => (
    <G rotation={rotation} origin={`${size/2},${size/2}`}>
      <Path
        d={`M ${size/2} ${size*0.15} L ${size/2} ${size*0.78}`}
        stroke={stroke}
        strokeWidth={strokeWidth}
        fill={fill}
        strokeLinecap="round"
      />
      <Path
        d={`M ${size*0.28} ${size*0.38} L ${size/2} ${size*0.15} L ${size*0.72} ${size*0.38}`}
        stroke={stroke}
        strokeWidth={strokeWidth}
        fill={fill}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </G>
  );

  const UTurn = ({ left = true }) => {
    // Semi-circle + arrowhead facing back
    const dir = left ? 1 : -1;
    const cx = size*0.5;
    const ry = size*0.26;
    const rx = size*0.18*dir;
    return (
      <G>
        <Path
          d={`M ${cx} ${size*0.78}
             L ${cx} ${size*0.45}
             C ${cx} ${size*0.25}, ${cx+rx} ${size*0.2}, ${cx+rx} ${size*0.45}
             L ${cx+rx} ${size*0.65}`}
          stroke={stroke}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
        />
        <Path
          d={`M ${cx+rx-(0.12*dir*size)} ${size*0.52}
             L ${cx+rx} ${size*0.65}
             L ${cx+rx+(0.12*dir*size)} ${size*0.52}`}
          stroke={stroke}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </G>
    );
  };

  const Merge = ({ left = true }) => {
    const dir = left ? -1 : 1;
    return (
      <G>
        {/* Main straight */}
        <ArrowHead rotation={0} />
        {/* Branch merging */}
        <Path
          d={`M ${size/2 + dir*size*0.22} ${size*0.78}
             L ${size/2 + dir*size*0.04} ${size*0.48}`}
          stroke={stroke}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
        />
      </G>
    );
  };

  const Fork = ({ left = true }) => {
    const rotLeft = -28;
    const rotRight = 28;
    return (
      <G>
        <ArrowHead rotation={left ? rotLeft : rotRight} />
        <ArrowHead rotation={left ? rotRight : rotLeft} />
      </G>
    );
  };

  const Roundabout = () => (
    <G>
      <Circle
        cx={size/2}
        cy={size/2}
        r={size*0.28}
        stroke={stroke}
        strokeWidth={strokeWidth}
        fill="none"
      />
      {exitNumber != null && (
        <SvgText
          x={size/2}
          y={size/2 + 4}
          fontSize={size*0.42}
          fontWeight="bold"
          fill={stroke}
          textAnchor="middle"
        >
          {exitNumber}
        </SvgText>
      )}
      {/* small entry/exit notch */}
      <Path
        d={`M ${size/2} ${size*0.22} L ${size/2} ${size*0.08}`}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </G>
  );

  const rotationFor = {
    left: -90,
    right: 90,
    slight_left: -25,
    slight_right: 25,
    sharp_left: -55,
    sharp_right: 55,
    straight: 0,
  };

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {type.startsWith('uturn_') && (
          <UTurn left={type.endsWith('_left')} />
        )}
        {type.startsWith('merge_') && (
          <Merge left={type.endsWith('_left')} />
        )}
        {type.startsWith('fork_') && (
          <Fork left={type.endsWith('_left')} />
        )}
        {type === 'roundabout' && <Roundabout />}

        {['straight','left','right','slight_left','slight_right','sharp_left','sharp_right'].includes(type) && (
          <ArrowHead rotation={rotationFor[type] ?? 0} />
        )}
      </Svg>
    </View>
  );
}
