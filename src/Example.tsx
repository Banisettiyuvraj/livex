import { TopographicFlow } from './components/topographic-flow';

export function Example() {
  return (
    <TopographicFlow
      animateEntrance={true}
      scale={480}
      density={5}
      speed={1.5}
      distortion={2.4}
      lineWidth={1}
      opacity={1}
      dashLength={7}
      dashGap={8}
      seed={42}
      gradientDiffusion={0}
      paused={false}
      hover={0.6}
      hoverRadius={200}
      hoverFollow={0.16}
      hoverFade={0.8}
      hoverEffect={"rings"}
      backgroundColor={"#000000"}
      backgroundImage={"none"}
      gradientColors={[]}
      grain={0}
      lineColor={"#ffffff"}
      accentColor={"#ffffff"}
      lineStyle={"solid"}
    />
  );
}
