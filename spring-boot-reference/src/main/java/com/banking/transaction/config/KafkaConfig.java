package com.banking.transaction.config;

import org.apache.kafka.clients.admin.NewTopic;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.config.TopicBuilder;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;

@Configuration
@ConditionalOnProperty(name = "spring.application.name", havingValue = "transaction-service")
public class KafkaConfig {

    @Bean
    public NewTopic transactionEvents() {
        return TopicBuilder.name("transaction-events")
                .partitions(3)
                .replicas(1)
                .build();
    }
}
