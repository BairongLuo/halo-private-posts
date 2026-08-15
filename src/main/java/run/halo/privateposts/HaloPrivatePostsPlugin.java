package run.halo.privateposts;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import run.halo.app.plugin.BasePlugin;
import run.halo.app.plugin.PluginContext;

@Component
public class HaloPrivatePostsPlugin extends BasePlugin {
    private static final Logger log = LoggerFactory.getLogger(HaloPrivatePostsPlugin.class);

    public HaloPrivatePostsPlugin(PluginContext pluginContext) {
        super(pluginContext);
    }

    @Override
    public void start() {
        log.info("内容隐藏插件已启动。");
    }

    @Override
    public void stop() {
        log.info("内容隐藏插件已停止。");
    }
}
