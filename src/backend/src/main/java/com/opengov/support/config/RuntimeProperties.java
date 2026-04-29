package com.opengov.support.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "opengov")
public class RuntimeProperties {

    private final Pool pool = new Pool();
    private final Coalescer coalescer = new Coalescer();

    public Pool getPool() { return pool; }
    public Coalescer getCoalescer() { return coalescer; }

    public static class Pool {
        private int workers = 0;
        private int queue = 1024;
        private int fastThreshold = 4096;

        public int getWorkers() { return workers; }
        public void setWorkers(int workers) { this.workers = workers; }
        public int getQueue() { return queue; }
        public void setQueue(int queue) { this.queue = queue; }
        public int getFastThreshold() { return fastThreshold; }
        public void setFastThreshold(int fastThreshold) { this.fastThreshold = fastThreshold; }
    }

    public static class Coalescer {
        private boolean enabled = true;
        private int shards = 32;

        public boolean isEnabled() { return enabled; }
        public void setEnabled(boolean enabled) { this.enabled = enabled; }
        public int getShards() { return shards; }
        public void setShards(int shards) { this.shards = shards; }
    }
}
