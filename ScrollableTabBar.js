const React = require('react');
const { ViewPropTypes } = ReactNative = require('react-native');
const PropTypes = require('prop-types');
const createReactClass = require('create-react-class');
const {
  View,
  Animated,
  StyleSheet,
  ScrollView,
  Text,
  Platform,
  Dimensions,
} = ReactNative;
const Button = require('./Button');

const WINDOW_WIDTH = Dimensions.get('window').width;

const ScrollableTabBar = createReactClass({
  propTypes: {
    goToPage: PropTypes.func,
    activeTab: PropTypes.number,
    tabs: PropTypes.array,
    backgroundColor: PropTypes.string,
    activeTextColor: PropTypes.string,
    inactiveTextColor: PropTypes.string,
    scrollOffset: PropTypes.number,
    style: ViewPropTypes.style,
    tabStyle: ViewPropTypes.style,
    tabsContainerStyle: ViewPropTypes.style,
    textStyle: Text.propTypes?.style,
    renderTab: PropTypes.func,
    underlineStyle: ViewPropTypes.style,
    onScroll: PropTypes.func,
  },

  getDefaultProps() {
    return {
      scrollOffset: 52,
      activeTextColor: 'navy',
      inactiveTextColor: 'black',
      backgroundColor: null,
      style: {},
      tabStyle: {},
      tabsContainerStyle: {},
      underlineStyle: {},
    };
  },

  getInitialState() {
    this._tabsMeasurements = [];
    // 下划线插值节点的重建版本号：全部页签测量就绪（或页签集变化）时 +1，
    // 作为插值节点缓存 key；与测量无关的 re-render 复用缓存，不重复建节点
    return {
      _containerWidth: null,
      _underlineMeasureVersion: 0,
    };
  },

  componentDidMount() {
    // 下划线插值全链 native 化：scrollValue 在 iOS 是 divide(scrollXIOS, width)、
    // Android 是 add(position, offset)，输入均由 useNativeDriver 的
    // Animated.event 直接驱动。__makeNative 后 interpolate 输出的
    // translateX/scaleX 完全在 UI 线程逐帧求值，JS 线程繁忙（切页签后
    // 新页面列表加载渲染）时下划线动画不再断帧。
    // 白名单依据：left/width 是布局属性，native animated 不支持（见 RN
    // NativeAnimatedAllowlist），transform 类属性支持，故用 translateX+scaleX
    // 组合表达「平移 + 伸缩」，与逐帧线性插值 left/width 数学等价。
    if (this.props.scrollValue && this.props.scrollValue.__makeNative) {
      this.props.scrollValue.__makeNative();
    }
    this.props.scrollValue.addListener(this.updateView);
  },

  updateView(offset) {
    const position = Math.floor(offset.value);
    const pageOffset = offset.value % 1;
    const tabCount = this.props.tabs.length;
    const lastTabPosition = tabCount - 1;

    if (tabCount === 0 || offset.value < 0 || offset.value > lastTabPosition) {
      return;
    }

    if (this.necessarilyMeasurementsCompleted(position, position === lastTabPosition)) {
      this.updateTabPanel(position, pageOffset);
      // 下划线位置由 native 插值节点驱动，这里不再做逐帧 setValue
    }
  },

  necessarilyMeasurementsCompleted(position, isLastTab) {
    return this._tabsMeasurements[position] &&
      (isLastTab || this._tabsMeasurements[position + 1]) &&
      this._tabContainerMeasurements &&
      this._containerMeasurements;
  },

  // 全部页签测量就绪：native 插值节点的 outputRange 需要每个页签的位置与宽度
  _allMeasurementsCompleted() {
    const tabCount = this.props.tabs.length;
    if (tabCount === 0) {
      return false;
    }
    for (let i = 0; i < tabCount; i++) {
      if (!this._tabsMeasurements[i]) {
        return false;
      }
    }
    return true;
  },

  updateTabPanel(position, pageOffset) {
    const containerWidth = this._containerMeasurements.width;
    const tabWidth = this._tabsMeasurements[position].width;
    const nextTabMeasurements = this._tabsMeasurements[position + 1];
    const nextTabWidth = nextTabMeasurements && nextTabMeasurements.width || 0;
    const tabOffset = this._tabsMeasurements[position].left;
    const absolutePageOffset = pageOffset * tabWidth;
    let newScrollX = tabOffset + absolutePageOffset;

    // center tab and smooth tab change (for when tabWidth changes a lot between two tabs)
    newScrollX -= (containerWidth - (1 - pageOffset) * tabWidth - pageOffset * nextTabWidth) / 2;
    newScrollX = newScrollX >= 0 ? newScrollX : 0;

    if (Platform.OS === 'android') {
      this._scrollView?.scrollTo({ x: newScrollX, y: 0, animated: false, });
    } else {
      const rightBoundScroll = this._tabContainerMeasurements.width - (this._containerMeasurements.width);
      newScrollX = newScrollX > rightBoundScroll ? rightBoundScroll : newScrollX;
      this._scrollView?.scrollTo({ x: newScrollX, y: 0, animated: false, });
    }

  },

  renderTab(name, page, isTabActive, onPressHandler, onLayoutHandler) {
    const { activeTextColor, inactiveTextColor, textStyle, } = this.props;
    const textColor = isTabActive ? activeTextColor : inactiveTextColor;
    const fontWeight = isTabActive ? 'bold' : 'normal';

    return <Button
      key={`${name}_${page}`}
      accessible={true}
      accessibilityLabel={name}
      accessibilityTraits='button'
      onPress={() => onPressHandler(page)}
      onLayout={onLayoutHandler}
    // style={{backgroundColor: 'blue'}}
    >
      <View style={[styles.tab, this.props.tabStyle,]}>
        <Text style={[{ color: textColor, fontWeight, }, textStyle,]}>
          {name}
        </Text>
      </View>
    </Button>;
  },

  measureTab(page, event) {
    const { x, width, height, } = event.nativeEvent.layout;
    this._tabsMeasurements[page] = { left: x, right: x + width, width, height, };
    if (this._allMeasurementsCompleted()) {
      this.setState((state) => ({
        _underlineMeasureVersion: state._underlineMeasureVersion + 1,
      }));
    }
    this.updateView({ value: this.props.scrollValue.__getValue(), });
  },

  // 下划线样式：scrollValue → translateX/scaleX 两个 native 插值节点。
  // 视图基准宽取最宽页签（base），scaleX 恒 ≤ 1（只缩小不放大，避免圆角被
  // 横向拉伸变形）；transform origin 是中心，渲染左缘满足
  //   left = translateX - (scaleX - 1) * base / 2
  // 用 (width - base)/2 补偿后，任意中间态与旧实现逐帧线性插值
  // left/width 的结果完全一致（等宽页签时 scaleX 恒定，退化为纯平移）。
  buildUnderlineStyle(scrollValue, tabCount, measureVersion) {
    const measurements = this._tabsMeasurements.slice(0, tabCount);
    // 测量未就绪时下划线不可见（与旧实现零宽初始态一致），测量齐后重建节点
    if (!scrollValue || measurements.length < tabCount) {
      return { width: 0 };
    }
    // left: 0 钉住原点——absolute 视图未显式指定 left 时，Yoga 会按父容器
    // flex 对齐（space-around）摆放，静态位置非 0，translateX 会整体偏移
    const origin = { left: 0 };
    if (
      this._cachedUnderline &&
      this._cachedUnderline.measureVersion === measureVersion
    ) {
      return this._cachedUnderline.style;
    }
    const widths = measurements.map((m) => Math.max(m.width, 0.01));
    const base = Math.max(...widths);
    let inputRange = measurements.map((_, i) => i);
    let translateXOutput = measurements.map((m) => m.left + (m.width - base) / 2);
    let scaleXOutput = widths.map((w) => w / base);
    if (inputRange.length === 1) {
      // 单页签：插值节点要求至少两点，复制为等值两点（恒定位置与宽度）
      inputRange = [0, 1];
      translateXOutput = [translateXOutput[0], translateXOutput[0]];
      scaleXOutput = [scaleXOutput[0], scaleXOutput[0]];
    }
    const style = {
      ...origin,
      width: base,
      transform: [
        {
          translateX: scrollValue.interpolate({
            inputRange,
            outputRange: translateXOutput,
            extrapolate: 'clamp',
          }),
        },
        {
          scaleX: scrollValue.interpolate({
            inputRange,
            outputRange: scaleXOutput,
            extrapolate: 'clamp',
          }),
        },
      ],
    };
    this._cachedUnderline = { measureVersion, style };
    return style;
  },

  render() {
    const tabUnderlineStyle = {
      position: 'absolute',
      height: 4,
      backgroundColor: 'navy',
      bottom: 0,
    };

    const dynamicTabUnderline = this.buildUnderlineStyle(
      this.props.scrollValue,
      this.props.tabs.length,
      this.state._underlineMeasureVersion
    );

    const {
      onScroll,
    } = this.props;

    return <View
      style={[styles.container, { backgroundColor: this.props.backgroundColor, }, this.props.style,]}
      onLayout={this.onContainerLayout}
    >
      <ScrollView
        ref={(scrollView) => { this._scrollView = scrollView; }}
        horizontal={true}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        directionalLockEnabled={true}
        bounces={false}
        scrollsToTop={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        <View
          style={[styles.tabs, { width: this.state._containerWidth, }, this.props.tabsContainerStyle,]}
          ref={'tabContainer'}
          onLayout={this.onTabContainerLayout}
        >
          {this.props.tabs.map((name, page) => {
            const isTabActive = this.props.activeTab === page;
            const renderTab = this.props.renderTab || this.renderTab;
            return renderTab(name, page, isTabActive, this.props.goToPage, this.measureTab.bind(this, page));
          })}
          <Animated.View style={[tabUnderlineStyle, dynamicTabUnderline, this.props.underlineStyle,]} />
        </View>
      </ScrollView>
    </View>;
  },

  componentDidUpdate(prevProps) {
    // If the tabs change, force the width of the tabs container to be recalculated
    if (JSON.stringify(prevProps.tabs) !== JSON.stringify(this.props.tabs) && this.state._containerWidth) {
      // 页签集变化：清空测量与插值节点缓存，待新一轮 onLayout 测量后重建
      this._tabsMeasurements = [];
      this._cachedUnderline = null;
      this.setState({
        _containerWidth: null,
        _underlineMeasureVersion: 0,
      });
    }
  },

  onTabContainerLayout(e) {
    const { style } = this.props;
    this._tabContainerMeasurements = e.nativeEvent.layout;
    let width = this._tabContainerMeasurements.width;
    const maxWidth = getWidthFromStyle(style);
    if (width < maxWidth) {
      width = maxWidth;
    }
    this.setState({ _containerWidth: width, });
    this.updateView({ value: this.props.scrollValue.__getValue(), });
  },

  onContainerLayout(e) {
    this._containerMeasurements = e.nativeEvent.layout;
    this.updateView({ value: this.props.scrollValue.__getValue(), });
  },
});

const getWidthFromStyle = (style, fallbackWidth = Dimensions.get('window').width) => {
  const flattenStyle = StyleSheet.flatten(style) || {};
  const { width } = flattenStyle;
  return typeof width === 'number' && width > 0 ? width : fallbackWidth;
};

module.exports = ScrollableTabBar;
module.exports.getWidthFromStyle = getWidthFromStyle;

const styles = StyleSheet.create({
  tab: {
    height: 49,
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 20,
    paddingRight: 20,
  },
  container: {
    height: 50,
    borderWidth: 1,
    borderTopWidth: 0,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderColor: '#ccc',
  },
  tabs: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
});
